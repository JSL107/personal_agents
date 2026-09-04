import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';
import {
  ChatPostMessageArguments,
  ChatPostMessageResponse,
} from '@slack/web-api';

import { appendIntegrationHint } from '../common/domain/integration-failure-hint';
import { PreviewCardMessage } from '../preview-gate/domain/preview-action.type';
import {
  SLACK_HANDLER_PORT,
  SlackHandler,
} from './domain/port/slack-handler.port';
import { toReadableSlackArgs } from './format/message-blocks.builder';
import { buildPreviewBlocks } from './format/preview-message.builder';
import { buildSubconsciousProposalBlocks } from './format/subconscious-proposal-message.builder';

const SOCKET_WATCHDOG_INTERVAL_MS = 30_000;
const SOCKET_DRIFT_THRESHOLD_MS = 90_000;

type SlackSocketConfig = {
  botToken: string;
  appToken: string;
  signingSecret: string;
};

export const shouldRefreshSocketAfterDrift = (
  elapsedMs: number,
  intervalMs: number,
  driftThresholdMs: number,
): boolean => {
  const driftMs = elapsedMs - intervalMs;
  return driftMs > driftThresholdMs;
};

// 이대리 Slack 어댑터.
// 책임: (1) Bolt App lifecycle (Socket Mode 기동/종료), (2) 외부 발송 API (postMessage / postPreviewMessage) 노출,
// (3) 부팅 시 SLACK_HANDLER_PORT multi-provider 의 모든 핸들러 일괄 register.
//
// 명령/액션/이벤트 본체와 텍스트 포매팅은 src/slack/handler/, src/slack/format/ 로 위임.
// C-5 — reaction_added 이벤트 처리도 SlackInboxReactionHandler 로 분리되어 본 service 는
// lifecycle + sender API 만 남았다.
//
// SLACK_BOT_TOKEN / SLACK_APP_TOKEN / SLACK_SIGNING_SECRET 가 모두 설정된 경우에만 Socket Mode 로 기동.
// 토큰이 없는 로컬/CI 환경에서는 경고 로그만 남기고 부팅 계속 (멀티 도메인 앱에서 Slack 이 부팅 블로커가 되지 않게).
@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app?: App;
  // 토큰이 설정돼 있는지(=Slack 을 쓰려는 의도인지). app 부재 원인을 "설정 누락"과
  // "아직 기동 전/기동 실패"로 구분하기 위해 onModuleInit 에서 세팅한다.
  private isConfigured = false;
  private socketWatchdog?: ReturnType<typeof setInterval>;
  private lastWatchdogTickAt = 0;
  private reconnecting = false;

  constructor(
    private readonly configService: ConfigService,
    @Inject(SLACK_HANDLER_PORT)
    private readonly slackHandlers: SlackHandler[],
  ) {}

  async onModuleInit(): Promise<void> {
    const config = this.getSlackSocketConfig();
    if (!config) {
      return;
    }
    this.isConfigured = true;

    // Slack 기동 실패(유효하지 않은 토큰, Slack 일시적 장애 등)가 전체 NestJS 앱 부팅을 막지 않도록 격리한다.
    // 앱은 계속 떠 있고 Slack 기능만 비활성화된 상태로 남는다.
    try {
      const app = await this.createStartedSlackApp(config);
      this.app = app;
      this.startSocketWatchdog();
      this.logger.log('이대리 Slack 봇이 Socket Mode 로 기동되었습니다.');
    } catch (error: unknown) {
      this.logger.error(
        '이대리 Slack 봇 기동 실패 — 앱은 계속 부팅되며 Slack 기능만 비활성화됩니다.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.socketWatchdog) {
      clearInterval(this.socketWatchdog);
      this.socketWatchdog = undefined;
    }
    if (!this.app) {
      return;
    }
    await this.app.stop();
    this.logger.log('이대리 Slack 봇이 정상 종료되었습니다.');
  }

  private getSlackSocketConfig(): SlackSocketConfig | null {
    const botToken = this.configService.get<string>('SLACK_BOT_TOKEN');
    const appToken = this.configService.get<string>('SLACK_APP_TOKEN');
    const signingSecret = this.configService.get<string>(
      'SLACK_SIGNING_SECRET',
    );

    const missingKeys = [
      ['SLACK_BOT_TOKEN', botToken],
      ['SLACK_APP_TOKEN', appToken],
      ['SLACK_SIGNING_SECRET', signingSecret],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missingKeys.length > 0) {
      this.logger.warn(
        `Slack 토큰 누락: ${missingKeys.join(', ')} — 이대리 Slack 봇을 초기화하지 않습니다.`,
      );
      return null;
    }
    if (!botToken || !appToken || !signingSecret) {
      return null;
    }

    return { botToken, appToken, signingSecret };
  }

  private async createStartedSlackApp({
    appToken,
    botToken,
    signingSecret,
  }: SlackSocketConfig): Promise<App> {
    const app = new App({
      token: botToken,
      appToken,
      signingSecret,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.registerHandlers(app);
    await app.start();
    return app;
  }

  private startSocketWatchdog(): void {
    if (this.socketWatchdog) {
      clearInterval(this.socketWatchdog);
    }
    this.lastWatchdogTickAt = Date.now();
    this.socketWatchdog = setInterval(() => {
      void this.onWatchdogTick();
    }, SOCKET_WATCHDOG_INTERVAL_MS);
  }

  private async onWatchdogTick(): Promise<void> {
    try {
      const now = Date.now();
      const elapsedMs = now - this.lastWatchdogTickAt;
      this.lastWatchdogTickAt = now;
      if (
        shouldRefreshSocketAfterDrift(
          elapsedMs,
          SOCKET_WATCHDOG_INTERVAL_MS,
          SOCKET_DRIFT_THRESHOLD_MS,
        )
      ) {
        await this.refreshSocketConnection(elapsedMs);
      }
    } catch (error: unknown) {
      this.logger.error(
        'Socket Mode 워치독 tick 처리 실패 — 다음 tick 에 재시도합니다.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async refreshSocketConnection(elapsedMs: number): Promise<void> {
    if (this.reconnecting || !this.app) {
      return;
    }
    this.reconnecting = true;
    try {
      this.logger.warn(
        `절전/일시정지 감지 (tick 간격 ${Math.round(elapsedMs / 1000)}s) — Socket Mode 재연결 시도`,
      );
      await this.app.stop();
      const config = this.getSlackSocketConfig();
      if (!config) {
        return;
      }
      const app = await this.createStartedSlackApp(config);
      this.app = app;
      this.logger.log('Socket Mode 재연결 완료');
    } catch (error: unknown) {
      this.logger.error(
        'Socket Mode 재연결 실패 — 다음 tick 에 재시도',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.reconnecting = false;
      this.lastWatchdogTickAt = Date.now();
    }
  }

  // PRO-1: 외부 호출자(MorningBriefingConsumer 등) 가 사용자 DM(`U...`) 또는 채널(`C.../G...`) 로 메시지 발송.
  // chat.postMessage 의 `channel` 파라미터는 user/channel/group ID 셋 다 받는다.
  // private 채널이면 봇이 invite 돼 있어야 함 (외부 운영 책임).
  // 봇이 비활성(env 누락) 상태면 graceful — 호출자에게 명확한 예외로 끊는다.
  // this.app 이 없을 때 원인을 구분해 던진다 — "설정 누락(토큰 미설정)"과 "아직 기동 전/기동 실패
  // (토큰은 설정됨)"는 완전히 다른 상황이다. 후자를 토큰 문제로 오진하면 부팅 레이스/연결 실패를
  // 엉뚱하게 진단하게 된다. app 이 있으면 그대로 반환해 호출부에서 non-null 로 쓰게 한다.
  private assertAppReady(): App {
    if (this.app) {
      return this.app;
    }
    if (!this.isConfigured) {
      throw new Error(
        'Slack 봇이 비활성 상태입니다 (SLACK_BOT_TOKEN/APP_TOKEN/SIGNING_SECRET 누락).',
      );
    }
    throw new Error(
      'Slack 봇이 아직 기동되지 않았습니다 (토큰은 설정됨 — 부팅 완료 전 호출이거나 Socket Mode 연결 실패).',
    );
  }

  // 발송 3종이 전부 이 한 지점을 지난다. Slack 이 준 코드(`channel_not_found` 등)는 그대로
  // 두면 영어 한 단어라, 여기서 한국어 행동 한 줄을 붙여 다시 던진다.
  // 발송이 실패한 상황이라 이 문구는 Slack 이 아니라 호출부의 로그·원장으로 간다 —
  // 대표가 "왜 안 왔지" 를 되짚을 때 읽는 자리가 거기다.
  private async postChat(
    args: ChatPostMessageArguments,
  ): Promise<ChatPostMessageResponse> {
    const app = this.assertAppReady();
    try {
      return await app.client.chat.postMessage(args);
    } catch (error: unknown) {
      // 새 Error 로 감싸지 않고 원본의 message 만 고쳐 던진다. 감싸면 Slack SDK 가 준
      // `data.error` · 클래스 · 원본 스택이 사라져, 나중에 코드로 분기하려는 호출부가 막힌다.
      // (`stack` 첫 줄에는 옛 message 가 남지만, 로거가 읽는 건 `message` 다.)
      if (!(error instanceof Error)) {
        throw new Error(
          appendIntegrationHint(`Slack 발송 실패: ${String(error)}`, error),
        );
      }
      error.message = appendIntegrationHint(
        `Slack 발송 실패: ${error.message}`,
        error,
      );
      throw error;
    }
  }

  async postMessage({
    target,
    text,
    threadTs,
    unfurlLinks,
  }: {
    target: string;
    text: string;
    threadTs?: string;
    unfurlLinks?: boolean;
  }): Promise<{ ts: string | undefined }> {
    const response = await this.postChat({
      channel: target,
      ...toReadableSlackArgs(text),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      // 미디어(썸네일)도 함께 꺼야 한다 — unfurl_links 만 끄면 이미지가 딸린 링크는
      // 여전히 펼쳐진다. 값을 안 주면 슬랙 기본값(켜짐)이라 기존 발송은 그대로다.
      ...(unfurlLinks === false
        ? { unfurl_links: false, unfurl_media: false }
        : {}),
    });
    return { ts: response.ts };
  }

  // PO-2: previewId 가 박힌 ✅ apply / ❌ cancel 버튼 Block Kit 메시지 발송.
  // PM-2 등 사용자 confirm 이 필요한 명령에서 호출. 사용자가 버튼을 누르면 preview-action.handler 가
  // body.actions[0].value (=previewId) 와 body.user.id 로 PreviewGate usecase 위임.
  async postPreviewMessage({
    target,
    preview,
  }: {
    target: string;
    preview: PreviewCardMessage;
  }): Promise<{ channelId: string; messageTs: string }> {
    const response = await this.postChat({
      channel: target,
      text: preview.previewText,
      // Bolt 의 blocks union 은 매우 엄격 (KnownBlock) — Block Kit JSON 을 그대로 쓰기 위해 narrow cast.
      blocks: buildPreviewBlocks({
        previewText: preview.previewText,
        previewId: preview.id,
        kind: preview.kind,
        payload: preview.payload,
      }) as never,
    });
    return {
      channelId: String(response.channel ?? target),
      messageTs: String(response.ts ?? ''),
    };
  }

  // Subconscious proposal — proposalId 가 박힌 ✅실행 / ❌무시 버튼 Block Kit DM 발송.
  // chat.postMessage 반환값의 channel + ts 를 SubconsciousProposalService 가 DB 에 기록.
  async postProposalMessage({
    target,
    proposalText,
    proposalId,
  }: {
    target: string;
    proposalText: string;
    proposalId: number;
  }): Promise<{ channelId: string; messageTs: string }> {
    const response = await this.postChat({
      channel: target,
      text: proposalText,
      blocks: buildSubconsciousProposalBlocks({
        proposalText,
        proposalId,
      }) as never,
    });
    return {
      channelId: String(response.channel ?? target),
      messageTs: String(response.ts ?? ''),
    };
  }

  // C-4 완결 + C-5 — SLACK_HANDLER_PORT multi-provider 로 등록된 모든 핸들러 (명령/액션/이벤트) 일괄 register.
  // 새 핸들러는 SlackHandler 구현 + SlackModule providers 등록만 하면 자동 합류.
  private registerHandlers(app: App): void {
    for (const handler of this.slackHandlers) {
      handler.register(app);
    }
  }
}
