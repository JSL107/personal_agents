import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../agent/be/application/generate-backend-plan.usecase';
import { ReviewPullRequestUsecase } from '../agent/code-reviewer/application/review-pull-request.usecase';
import { SaveReviewOutcomeUsecase } from '../agent/code-reviewer/application/save-review-outcome.usecase';
import { GenerateImpactReportUsecase } from '../agent/impact-reporter/application/generate-impact-report.usecase';
import { GenerateDailyPlanUsecase } from '../agent/pm/application/generate-daily-plan.usecase';
import { SyncContextUsecase } from '../agent/pm/application/sync-context.usecase';
import { SyncPlanUsecase } from '../agent/pm/application/sync-plan.usecase';
import { GeneratePoOutlineUsecase } from '../agent/po-expand/application/generate-po-outline.usecase';
import { GeneratePoShadowUsecase } from '../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../agent/work-reviewer/application/generate-worklog.usecase';
import { GetQuotaStatsUsecase } from '../agent-run/application/get-quota-stats.usecase';
import { RetryRunUsecase } from '../agent-run/application/retry-run.usecase';
import { ApplyPreviewUsecase } from '../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../preview-gate/application/cancel-preview.usecase';
import { SlackInboxService } from '../slack-inbox/application/slack-inbox.service';
import { buildPreviewBlocks } from './format/preview-message.builder';
import { registerAgentCommandHandlers } from './handler/agent-command.handler';
import { registerDiagnosisHandlers } from './handler/diagnosis.handler';
import { registerPreviewActionHandlers } from './handler/preview-action.handler';
import { registerWriteBackHandlers } from './handler/write-back.handler';

// 이대리 Slack 어댑터.
// 책임: (1) Bolt App lifecycle (Socket Mode 기동/종료), (2) 명령/액션 핸들러 라우팅,
// (3) 외부 발송 API (postMessage / postPreviewMessage) 노출.
// 핸들러 본체와 텍스트 포매팅은 src/slack/handler/, src/slack/format/ 로 위임.
//
// SLACK_BOT_TOKEN / SLACK_APP_TOKEN / SLACK_SIGNING_SECRET 가 모두 설정된 경우에만 Socket Mode 로 기동.
// 토큰이 없는 로컬/CI 환경에서는 경고 로그만 남기고 부팅 계속 (멀티 도메인 앱에서 Slack 이 부팅 블로커가 되지 않게).
@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app?: App;

  constructor(
    private readonly configService: ConfigService,
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly saveReviewOutcomeUsecase: SaveReviewOutcomeUsecase,
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    private readonly generatePoOutlineUsecase: GeneratePoOutlineUsecase,
    private readonly generateBackendPlanUsecase: GenerateBackendPlanUsecase,
    private readonly syncContextUsecase: SyncContextUsecase,
    private readonly getQuotaStatsUsecase: GetQuotaStatsUsecase,
    private readonly retryRunUsecase: RetryRunUsecase,
    private readonly applyPreviewUsecase: ApplyPreviewUsecase,
    private readonly cancelPreviewUsecase: CancelPreviewUsecase,
    private readonly syncPlanUsecase: SyncPlanUsecase,
    private readonly slackInboxService: SlackInboxService,
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

    this.registerCommands(app);
    this.registerReactionHandlers(app);

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

  private registerReactionHandlers(app: App): void {
    const inboxEmoji =
      this.configService.get<string>('SLACK_INBOX_EMOJI') ?? 'raised_hand';

    app.event('reaction_added', async ({ event, client }) => {
      if (event.reaction !== inboxEmoji) {
        return;
      }
      if (event.item.type !== 'message') {
        return;
      }
      if (!event.user) {
        return;
      }

      try {
        const history = await client.conversations.history({
          channel: event.item.channel,
          latest: event.item.ts,
          inclusive: true,
          limit: 1,
        });
        const message = history.messages?.[0];
        if (!message?.text) {
          return;
        }

        await this.slackInboxService.addItem({
          slackUserId: event.user,
          channelId: event.item.channel,
          messageTs: event.item.ts,
          text: message.text,
        });
        this.logger.log(
          `Slack Inbox 추가 — user=${event.user} channel=${event.item.channel} ts=${event.item.ts}`,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Slack Inbox 추가 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  // 카테고리별 핸들러 모듈로 위임 — 각 핸들러는 ack/respond/usecase 호출만 담당.
  // 추가 명령은 적절한 카테고리에 끼워넣거나 새 register…Handlers 모듈을 만들어 여기에 등록한다.
  private registerCommands(app: App): void {
    registerPreviewActionHandlers(app, {
      applyPreviewUsecase: this.applyPreviewUsecase,
      cancelPreviewUsecase: this.cancelPreviewUsecase,
    });
    registerDiagnosisHandlers(app, {
      syncContextUsecase: this.syncContextUsecase,
      getQuotaStatsUsecase: this.getQuotaStatsUsecase,
      logger: this.logger,
    });
    registerAgentCommandHandlers(app, {
      generateDailyPlanUsecase: this.generateDailyPlanUsecase,
      generateWorklogUsecase: this.generateWorklogUsecase,
      reviewPullRequestUsecase: this.reviewPullRequestUsecase,
      saveReviewOutcomeUsecase: this.saveReviewOutcomeUsecase,
      generateImpactReportUsecase: this.generateImpactReportUsecase,
      generatePoShadowUsecase: this.generatePoShadowUsecase,
      generatePoOutlineUsecase: this.generatePoOutlineUsecase,
      generateBackendPlanUsecase: this.generateBackendPlanUsecase,
      retryRunUsecase: this.retryRunUsecase,
      logger: this.logger,
    });
    registerWriteBackHandlers(app, {
      syncPlanUsecase: this.syncPlanUsecase,
      logger: this.logger,
    });
  }
}
