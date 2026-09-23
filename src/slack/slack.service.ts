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
import {
  toImageAttachedSlackArgs,
  toReadableSlackArgs,
} from './format/message-blocks.builder';
import { buildPreviewBlocks } from './format/preview-message.builder';
import { recordSlackSendLength } from './format/slack-send-length.recorder';
import { buildSubconsciousProposalBlocks } from './format/subconscious-proposal-message.builder';

const SOCKET_WATCHDOG_INTERVAL_MS = 30_000;
const SOCKET_DRIFT_THRESHOLD_MS = 90_000;

// 올린 파일을 슬랙이 이미지로 처리할 때까지 기다리는 상한과 간격. 2026-09-23 실측으로
// 업로드 시작에서 `mimetype: 'image/png'` 까지 2,218ms 였다 — 상한은 그 3배 남짓을 둔다.
// 이 대기를 건너뛰고 메시지를 보내면 이미지 블록이 빈 자리로 뜬다.
const IMAGE_READY_TIMEOUT_MS = 8_000;
const IMAGE_READY_POLL_INTERVAL_MS = 400;

type SlackSocketConfig = {
  botToken: string;
  appToken: string;
  signingSecret: string;
};

// `filesUploadV2` 응답에서 올라간 파일의 id 를 꺼낸다. 이 메서드는 슬랙의 2단계 업로드
// (`getUploadURLExternal` → `completeUploadExternal`)를 감싼 것이라 응답이 한 겹 더
// 중첩돼 올 수 있다(`files[0].files[0]`). 2026-09-22 실측에서 그 형태였고, SDK 타입은
// 두 형태를 유니온으로 두고 있어 어느 쪽이 올지 컴파일 시점에 좁혀지지 않는다.
// id 를 못 찾는 것은 실패가 아니다 — 로그용 값이라 undefined 로 물러선다.
export const firstUploadedFileId = (response: unknown): string | undefined => {
  const files = (response as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) {
    return undefined;
  }
  const first = files[0] as { id?: unknown; files?: unknown };
  if (typeof first.id === 'string') {
    return first.id;
  }
  if (Array.isArray(first.files) && first.files.length > 0) {
    const nested = first.files[0] as { id?: unknown };
    return typeof nested.id === 'string' ? nested.id : undefined;
  }
  return undefined;
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
    image,
  }: {
    target: string;
    text: string;
    threadTs?: string;
    unfurlLinks?: boolean;
    image?: { fileId: string; altText: string };
  }): Promise<{ ts: string | undefined }> {
    const origin = threadTs ? 'push-thread' : 'push';
    const response = await this.postChat({
      channel: target,
      // 이대리가 먼저 밀어내는 경로 — 계측에서 슬래시·멘션 응답과 갈라 본다(설계서 §7-5).
      // 스레드 댓글은 본문과 길이 성격이 달라 따로 센다(cron 상세가 이 경로다).
      ...(image
        ? toImageAttachedSlackArgs(text, image, origin)
        : toReadableSlackArgs(text, origin)),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      // 미디어(썸네일)도 함께 꺼야 한다 — unfurl_links 만 끄면 이미지가 딸린 링크는
      // 여전히 펼쳐진다. 값을 안 주면 슬랙 기본값(켜짐)이라 기존 발송은 그대로다.
      ...(unfurlLinks === false
        ? { unfurl_links: false, unfurl_media: false }
        : {}),
    });
    return { ts: response.ts };
  }

  // 이미지 업로드. `chat.postMessage` 와 달리 파일 API 를 쓰므로 `files:write` 스코프가
  // 필요하고, 없으면 슬랙이 `missing_scope` 로 끊는다.
  //
  // 반환하는 file id 는 로그·사후 확인용이다. 이 값이 있어도 그 순간 슬랙이 파일을 아직
  // 이미지로 처리하지 않았을 수 있다(포트 주석의 실측). 성공 판정은 예외 유무로만 한다.
  async uploadImage({
    target,
    threadTs,
    png,
    filename,
    title,
  }: {
    target: string;
    threadTs?: string;
    png: Buffer;
    filename: string;
    title: string;
  }): Promise<{ fileId: string | undefined }> {
    const app = this.assertAppReady();
    const destination = { channel_id: target, file: png, filename, title };
    // 호출을 둘로 가르는 이유는 SDK 타입이다 — `thread_ts` 를 실으면 `string` 이어야 하고
    // `string | undefined` 는 받지 않는다. 조건부 스프레드로 넣으면 그 유니온이 되어 막힌다.
    const response = threadTs
      ? await app.client.filesUploadV2({ ...destination, thread_ts: threadTs })
      : await app.client.filesUploadV2(destination);
    return { fileId: firstUploadedFileId(response) };
  }

  // 채널 공유 없이 파일만 올린다(`channel_id` 를 주지 않는다). 공유는 이 id 를 이미지
  // 블록으로 실은 `postMessage` 가 대신 하고, 그 메시지의 ts 로 스레드를 연다.
  //
  // 여기서는 file id 가 없으면 실패다 — `uploadImage` 와 달리 로그용이 아니라 메시지를
  // 만들 재료라, 없으면 그림 없는 메시지가 나가게 된다.
  async uploadImageFile({
    png,
    filename,
    title,
  }: {
    png: Buffer;
    filename: string;
    title: string;
  }): Promise<{ fileId: string }> {
    const app = this.assertAppReady();
    const response = await app.client.filesUploadV2({
      file: png,
      filename,
      title,
    });
    const fileId = firstUploadedFileId(response);
    if (!fileId) {
      throw new Error(
        `Slack 이미지 업로드 응답에 file id 가 없습니다 — filename=${filename}`,
      );
    }
    await this.waitUntilImageReady(fileId);
    return { fileId };
  }

  // 슬랙이 올라온 파일을 이미지로 처리했는지 `files.info` 로 확인한다. 업로드 응답만으로는
  // 알 수 없다(포트 주석의 실측). 상한까지 기다려도 안 되면 던져서, 호출부가 그림 없이
  // 텍스트만이라도 보내게 한다 — 빈 이미지 블록이 붙은 메시지보다 낫다.
  private async waitUntilImageReady(fileId: string): Promise<void> {
    const app = this.assertAppReady();
    const deadline = Date.now() + IMAGE_READY_TIMEOUT_MS;
    for (;;) {
      const info = await app.client.files.info({ file: fileId });
      if (info.file?.mimetype?.startsWith('image/')) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Slack 이 이미지로 처리하기를 ${IMAGE_READY_TIMEOUT_MS}ms 기다렸으나 끝나지 않았습니다 — fileId=${fileId}`,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, IMAGE_READY_POLL_INTERVAL_MS),
      );
    }
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
    // 카드는 blocks 로만 나가 toReadableSlackArgs 를 지나지 않는다 — 계측이 여기서 따로 붙는다.
    const blocks = buildPreviewBlocks({
      previewText: preview.previewText,
      previewId: preview.id,
      kind: preview.kind,
      payload: preview.payload,
    });
    recordSlackSendLength({
      text: preview.previewText,
      origin: 'card',
      blocks: blocks.length,
    });
    const response = await this.postChat({
      channel: target,
      text: preview.previewText,
      // Bolt 의 blocks union 은 매우 엄격 (KnownBlock) — Block Kit JSON 을 그대로 쓰기 위해 narrow cast.
      blocks: blocks as never,
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
    const blocks = buildSubconsciousProposalBlocks({
      proposalText,
      proposalId,
    });
    recordSlackSendLength({
      text: proposalText,
      origin: 'card',
      blocks: blocks.length,
    });
    const response = await this.postChat({
      channel: target,
      text: proposalText,
      blocks: blocks as never,
    });
    return {
      channelId: String(response.channel ?? target),
      messageTs: String(response.ts ?? ''),
    };
  }

  // Subconscious proposal 카드 종료 표시 — 자동 정리로 닫힌 카드의 버튼을 걷어낸다.
  //
  // blocks 를 빈 배열로 덮어써야 버튼이 사라진다. 생략하면 Slack 이 기존 blocks 를 유지해
  // 활성 버튼이 남고, 누른 사용자는 "이미 처리된 제안입니다" 오류만 받는다.
  //
  // **assertAppReady 까지 try 안에 둔다.** 이 메서드는 호출자에게 예외를 주지 않기로 약속한
  // 자리다(카드 표시는 부가 효과, DB 상태 전이가 정본 — SlackPreviewCardUpdater 선례).
  // 토큰은 설정됐는데 Socket Mode 기동 실패·재연결 중이면 app 이 없어 assertAppReady 가
  // 던지는데, 그것을 try 밖에 두면 그 예외가 dismissSweptPending 의 순회를 끊는다. 그 시점에
  // 레코드는 이미 DISMISSED 로 전이돼 다음 회차 listPending 에 잡히지 않으므로, Slack 이
  // 복구된 뒤에도 활성 버튼이 영구히 남는다.
  async closeProposalCard({
    channelId,
    messageTs,
    text,
  }: {
    channelId: string;
    messageTs: string;
    text: string;
  }): Promise<void> {
    try {
      const app = this.assertAppReady();
      await app.client.chat.update({
        channel: channelId,
        ts: messageTs,
        text,
        blocks: [],
      });
    } catch (error: unknown) {
      this.logger.warn(
        `제안 카드 종료 표시 실패(swallow) channel=${channelId} ts=${messageTs}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // C-4 완결 + C-5 — SLACK_HANDLER_PORT multi-provider 로 등록된 모든 핸들러 (명령/액션/이벤트) 일괄 register.
  // 새 핸들러는 SlackHandler 구현 + SlackModule providers 등록만 하면 자동 합류.
  private registerHandlers(app: App): void {
    for (const handler of this.slackHandlers) {
      handler.register(app);
    }
  }
}
