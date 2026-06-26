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
  SLACK_HANDLER_PORT,
  SlackHandler,
} from './domain/port/slack-handler.port';
import { buildPreviewBlocks } from './format/preview-message.builder';
import { buildSubconsciousProposalBlocks } from './format/subconscious-proposal-message.builder';

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

  constructor(
    private readonly configService: ConfigService,
    @Inject(SLACK_HANDLER_PORT)
    private readonly slackHandlers: SlackHandler[],
  ) {}

  async onModuleInit(): Promise<void> {
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
      return;
    }

    const app = new App({
      token: botToken,
      appToken,
      signingSecret,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.registerHandlers(app);

    // Slack 기동 실패(유효하지 않은 토큰, Slack 일시적 장애 등)가 전체 NestJS 앱 부팅을 막지 않도록 격리한다.
    // 앱은 계속 떠 있고 Slack 기능만 비활성화된 상태로 남는다.
    try {
      await app.start();
      this.app = app;
      this.logger.log('이대리 Slack 봇이 Socket Mode 로 기동되었습니다.');
    } catch (error: unknown) {
      this.logger.error(
        '이대리 Slack 봇 기동 실패 — 앱은 계속 부팅되며 Slack 기능만 비활성화됩니다.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.app) {
      return;
    }
    await this.app.stop();
    this.logger.log('이대리 Slack 봇이 정상 종료되었습니다.');
  }

  // PRO-1: 외부 호출자(MorningBriefingConsumer 등) 가 사용자 DM(`U...`) 또는 채널(`C.../G...`) 로 메시지 발송.
  // chat.postMessage 의 `channel` 파라미터는 user/channel/group ID 셋 다 받는다.
  // private 채널이면 봇이 invite 돼 있어야 함 (외부 운영 책임).
  // 봇이 비활성(env 누락) 상태면 graceful — 호출자에게 명확한 예외로 끊는다.
  async postMessage({
    target,
    text,
  }: {
    target: string;
    text: string;
  }): Promise<void> {
    if (!this.app) {
      throw new Error(
        'Slack 봇이 비활성 상태입니다 (SLACK_BOT_TOKEN/APP_TOKEN/SIGNING_SECRET 누락).',
      );
    }
    await this.app.client.chat.postMessage({ channel: target, text });
  }

  // PO-2: previewId 가 박힌 ✅ apply / ❌ cancel 버튼 Block Kit 메시지 발송.
  // PM-2 등 사용자 confirm 이 필요한 명령에서 호출. 사용자가 버튼을 누르면 preview-action.handler 가
  // body.actions[0].value (=previewId) 와 body.user.id 로 PreviewGate usecase 위임.
  async postPreviewMessage({
    target,
    previewText,
    previewId,
  }: {
    target: string;
    previewText: string;
    previewId: string;
  }): Promise<void> {
    if (!this.app) {
      throw new Error(
        'Slack 봇이 비활성 상태입니다 (SLACK_BOT_TOKEN/APP_TOKEN/SIGNING_SECRET 누락).',
      );
    }
    await this.app.client.chat.postMessage({
      channel: target,
      text: previewText,
      // Bolt 의 blocks union 은 매우 엄격 (KnownBlock) — Block Kit JSON 을 그대로 쓰기 위해 narrow cast.
      blocks: buildPreviewBlocks({ previewText, previewId }) as never,
    });
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
    if (!this.app) {
      throw new Error(
        'Slack 봇이 비활성 상태입니다 (SLACK_BOT_TOKEN/APP_TOKEN/SIGNING_SECRET 누락).',
      );
    }
    const response = await this.app.client.chat.postMessage({
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
