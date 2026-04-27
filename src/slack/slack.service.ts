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
import { GenerateImpactReportUsecase } from '../agent/impact-reporter/application/generate-impact-report.usecase';
import { GenerateDailyPlanUsecase } from '../agent/pm/application/generate-daily-plan.usecase';
import { SyncContextUsecase } from '../agent/pm/application/sync-context.usecase';
import { SyncPlanUsecase } from '../agent/pm/application/sync-plan.usecase';
import { GeneratePoShadowUsecase } from '../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../agent/work-reviewer/application/generate-worklog.usecase';
import { GetQuotaStatsUsecase } from '../agent-run/application/get-quota-stats.usecase';
import { DomainException } from '../common/exception/domain.exception';
import { ApplyPreviewUsecase } from '../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../preview-gate/application/cancel-preview.usecase';
import { PREVIEW_ACTION_IDS } from '../preview-gate/domain/preview-action.type';
import {
  extractActionUserId,
  extractActionValue,
} from './bolt/action-body.parser';
import { formatBackendPlan } from './format/backend-plan.formatter';
import { formatContextSummary } from './format/context-summary.formatter';
import { formatDailyPlan } from './format/daily-plan.formatter';
import { formatDailyReview } from './format/daily-review.formatter';
import { formatImpactReport } from './format/impact-report.formatter';
import { formatModelFooter } from './format/model-footer.formatter';
import { formatPoShadowReport } from './format/po-shadow.formatter';
import { buildPreviewBlocks } from './format/preview-message.builder';
import { formatPullRequestReview } from './format/pull-request-review.formatter';
import { formatQuotaStats } from './format/quota-stats.formatter';

// 이대리 Slack 어댑터.
// SLACK_BOT_TOKEN / SLACK_APP_TOKEN / SLACK_SIGNING_SECRET 가 모두 설정된 경우에만 Socket Mode 로 기동한다.
// 토큰이 없는 로컬/CI 환경에서는 경고 로그만 남기고 부팅을 계속한다 (멀티 도메인 환경에서 Slack 이 부팅 블로커가 되지 않도록).
@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app?: App;

  constructor(
    private readonly configService: ConfigService,
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    private readonly generateBackendPlanUsecase: GenerateBackendPlanUsecase,
    private readonly syncContextUsecase: SyncContextUsecase,
    private readonly getQuotaStatsUsecase: GetQuotaStatsUsecase,
    private readonly applyPreviewUsecase: ApplyPreviewUsecase,
    private readonly cancelPreviewUsecase: CancelPreviewUsecase,
    private readonly syncPlanUsecase: SyncPlanUsecase,
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

  // PRO-1: Slack 봇이 사용자 DM(`U...`) 또는 채널(`C.../G...`) 로 메시지를 발송한다.
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

  // 도메인 예외 message 는 그대로 노출, 그 외 (Prisma/네트워크/내부) 는 generic 으로 가린다 — 다른 핸들러와 동일 정책.
  private toUserFacingErrorMessage(error: unknown): string {
    if (error instanceof DomainException) {
      return error.message;
    }
    return '내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }

  // PO-2: previewId 가 박힌 ✅ apply / ❌ cancel 버튼이 달린 Block Kit 메시지 발송.
  // PM-2 등 사용자 confirm 이 필요한 명령에서 호출. 사용자가 버튼을 누르면 app.action 핸들러가 PreviewGate usecase 로 위임.
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

  private registerCommands(app: App): void {
    // PO-2 Preview Gate — apply / cancel 버튼 클릭 처리.
    // body.actions[0].value 에 previewId 가 들어 있고 body.user.id 가 클릭한 사용자.
    // ApplyPreviewUsecase 가 owner 매칭 + ttl + status 검증 + strategy.apply 위임.
    app.action(PREVIEW_ACTION_IDS.APPLY, async ({ ack, body, respond }) => {
      await ack();
      const previewId = extractActionValue(body);
      const slackUserId = extractActionUserId(body);
      if (!previewId || !slackUserId) {
        return;
      }
      try {
        const { resultText } = await this.applyPreviewUsecase.execute({
          previewId,
          slackUserId,
        });
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `✅ Preview 적용 완료 — ${resultText}`,
        });
      } catch (error: unknown) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `Preview 적용 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.action(PREVIEW_ACTION_IDS.CANCEL, async ({ ack, body, respond }) => {
      await ack();
      const previewId = extractActionValue(body);
      const slackUserId = extractActionUserId(body);
      if (!previewId || !slackUserId) {
        return;
      }
      try {
        await this.cancelPreviewUsecase.execute({ previewId, slackUserId });
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: '❌ Preview 취소됨 — 부작용 없이 마감되었습니다.',
        });
      } catch (error: unknown) {
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `Preview 취소 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/today', async ({ ack, command, respond }) => {
      // 자유 텍스트는 옵션. 빈 입력이면 GitHub assigned / Notion task / Slack 멘션 / 직전 PM·Work Reviewer
      // 자동 수집만으로 plan 생성 (사용자 발견 — 적을 일이 없을 때 굳이 텍스트 강제할 이유 없음).
      // 자동 컨텍스트도 모두 비어있으면 GenerateDailyPlanUsecase 가 EMPTY_TASKS_INPUT 으로 끊고 안내한다.
      const tasksText = command.text?.trim() ?? '';
      const ackMessage =
        tasksText.length === 0
          ? '이대리가 자동 수집한 컨텍스트(GitHub/Notion/Slack/어제 plan)로 오늘의 계획을 작성 중입니다 (10~20초 소요)...'
          : '이대리가 오늘의 계획을 작성 중입니다 (10~20초 소요)...';

      await ack({ response_type: 'ephemeral', text: ackMessage });

      try {
        const outcome = await this.generateDailyPlanUsecase.execute({
          tasksText,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text:
            formatDailyPlan(outcome.result.plan, outcome.result.sources) +
            formatModelFooter(outcome),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateDailyPlanUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /today 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/worklog', async ({ ack, command, respond }) => {
      const workText = command.text?.trim() ?? '';
      if (workText.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/worklog <오늘 한 일을 자유롭게 적어주세요>`',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: '이대리가 오늘의 회고를 작성 중입니다 (10~20초 소요)...',
      });

      try {
        const outcome = await this.generateWorklogUsecase.execute({
          workText,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatDailyReview(outcome.result) + formatModelFooter(outcome),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateWorklogUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /worklog 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/plan-task', async ({ ack, command, respond }) => {
      const subject = command.text?.trim() ?? '';
      if (subject.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/plan-task <PR URL / 작업 설명>` (예: `/plan-task 결제 검증 API 추가` 또는 `/plan-task foo/bar#34`)',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: `이대리(BE 모드) 가 구현 계획을 세우는 중입니다 (15~40초 소요)...`,
      });

      try {
        const outcome = await this.generateBackendPlanUsecase.execute({
          subject,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatBackendPlan(outcome.result) + formatModelFooter(outcome),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateBackendPlanUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /plan-task 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/po-shadow', async ({ ack, command, respond }) => {
      // /po-shadow 는 직전 PM plan 을 PO 시각으로 재검토 — 인자 없이도 OK (extra context optional).
      const extraContext = command.text?.trim() ?? '';
      await ack({
        response_type: 'ephemeral',
        text: '이대리(PO 모드) 가 직전 plan 을 재검토 중입니다 (10~30초 소요)...',
      });

      try {
        const outcome = await this.generatePoShadowUsecase.execute({
          extraContext,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text:
            formatPoShadowReport(outcome.result) + formatModelFooter(outcome),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GeneratePoShadowUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /po-shadow 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/impact-report', async ({ ack, command, respond }) => {
      const subject = command.text?.trim() ?? '';
      if (subject.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/impact-report <PR 링크 또는 task 설명>` (예: `/impact-report PR #34 — GitHub 커넥터 추가`)',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: `이대리가 임팩트 보고서를 작성 중입니다 (10~30초 소요)...`,
      });

      try {
        const outcome = await this.generateImpactReportUsecase.execute({
          subject,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatImpactReport(outcome.result) + formatModelFooter(outcome),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GenerateImpactReportUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /impact-report 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/sync-context', async ({ ack, command, respond }) => {
      // /sync-context 는 PM `/today` 가 보는 5종 컨텍스트 (GitHub/Notion/Slack/직전 plan/직전 worklog) 를
      // 모델 호출 없이 다시 한번 점검만 한다. AgentRun 도 만들지 않고 푸터(modelUsed/run#) 도 없다.
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 외부 컨텍스트를 재수집 중입니다 (5~15초 소요)...',
      });

      try {
        const summary = await this.syncContextUsecase.execute({
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatContextSummary(summary),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `SyncContextUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /sync-context 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/ping', async ({ ack }) => {
      // 봇 health check — 모델 호출 / DB 호출 없이 즉시 ack 만 응답.
      // Slack Bolt Socket Mode 가 살아있고 워크스페이스에 manifest 가 등록돼 있는지 1초 안에 확인 가능.
      await ack({
        response_type: 'ephemeral',
        text: 'pong 🏓 — 이대리 봇 정상 동작 중',
      });
    });

    app.command('/sync-plan', async ({ ack, command, respond }) => {
      // PM-2: 직전 PM plan 의 GITHUB/NOTION task subtasks 를 외부 시스템에 동기화하기 전 미리보기 + 동의 게이트.
      // SyncPlanUsecase 가 후보 추출 + PreviewAction 생성 → 응답으로 ✅/❌ Block Kit 메시지 노출.
      // 사용자가 ✅ 누르면 PmWriteBackApplier 가 GitHub Issue 코멘트 / Notion page Todo 추가.
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 동기화할 task 후보를 모으는 중입니다 (5~10초 소요)...',
      });

      try {
        const { previewId, previewText } = await this.syncPlanUsecase.execute({
          slackUserId: command.user_id,
        });
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: previewText,
          // Block Kit 의 apply/cancel 버튼 — 클릭 시 app.action(preview:apply|cancel) 핸들러로 이어짐.
          blocks: buildPreviewBlocks({ previewText, previewId }) as never,
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `SyncPlanUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /sync-plan 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/quota', async ({ ack, command, respond }) => {
      // OPS-1: /quota [today|week] — 사용자 자신의 agent_run 사용량 통계.
      // 인자 없으면 today 기본. 모델 호출 없이 DB groupBy 만 — 즉시 응답.
      const arg = command.text?.trim().toLowerCase() ?? '';
      const range: 'TODAY' | 'WEEK' = arg === 'week' ? 'WEEK' : 'TODAY';

      await ack({
        response_type: 'ephemeral',
        text: `이대리가 ${range === 'WEEK' ? '최근 7일' : '오늘'} 사용량을 집계 중입니다...`,
      });

      try {
        const stats = await this.getQuotaStatsUsecase.execute({
          slackUserId: command.user_id,
          range,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: formatQuotaStats(stats),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `GetQuotaStatsUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /quota 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });

    app.command('/review-pr', async ({ ack, command, respond }) => {
      const prRef = command.text?.trim() ?? '';
      if (prRef.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/review-pr <PR URL 또는 owner/repo#번호>` (예: `/review-pr https://github.com/foo/bar/pull/34`)',
        });
        return;
      }

      await ack({
        response_type: 'ephemeral',
        text: `이대리가 PR ${prRef} 를 리뷰하는 중입니다 (15~40초 소요)...`,
      });

      try {
        const outcome = await this.reviewPullRequestUsecase.execute({
          prRef,
          slackUserId: command.user_id,
        });

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text:
            formatPullRequestReview({ prRef, review: outcome.result }) +
            formatModelFooter(outcome),
        });
      } catch (error: unknown) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `ReviewPullRequestUsecase 실패: ${rawMessage}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: `이대리 /review-pr 실패: ${this.toUserFacingErrorMessage(error)}`,
        });
      }
    });
  }
}
