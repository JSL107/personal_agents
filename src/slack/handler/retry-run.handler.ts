import { Injectable, Logger } from '@nestjs/common';
import { App, RespondFn } from '@slack/bolt';

import { HumanizeService } from '../../humanize/application/humanize.service';
import { humanizeEvaluationOutput } from '../../humanize/application/humanize-report.adapter';
import {
  PreparedReplay,
  ReplayFailedRunUsecase,
} from '../../run-replay/application/replay-failed-run.usecase';
import { ReplayRejectionCode } from '../../run-replay/domain/run-replay.type';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { formatCeoMetaOutput } from '../format/ceo-meta.formatter';
import { formatDailyPlan } from '../format/daily-plan.formatter';
import { formatDailyReview } from '../format/daily-review.formatter';
import { formatImpactReport } from '../format/impact-report.formatter';
import { formatEvaluationOutput } from '../format/po-evaluation.formatter';
import { formatPoShadowReport } from '../format/po-shadow.formatter';
import { formatPullRequestReview } from '../format/pull-request-review.formatter';
import { formatVideoWatch } from '../format/video-watch.formatter';
import { respondBlogPublishOutcome } from './blog-publish.handler';
import {
  runAgentCommand,
  runEphemeral,
  toUserFacingErrorMessage,
} from './slack-handler.helper';

const KEEP_ORIGINAL_ON_REJECTION: ReadonlySet<ReplayRejectionCode> = new Set([
  ReplayRejectionCode.NOT_FOUND,
  ReplayRejectionCode.UNKNOWN_AGENT_TYPE,
]);

// /retry-run — FAILED AgentRun 의 inputSnapshot 으로 동일 작업을 재실행 (OPS-5).
// 판정·디스패치·재시도 계보는 콘솔 재시도 버튼과 함께 쓰는 `ReplayFailedRunUsecase` 에 있고,
// 여기는 Slack ack 와 결과를 Slack 문구로 바꾸는 일만 한다.
//
// C-4 Phase 9 — registerRetryRunHandler fn → @Injectable() class.
@Injectable()
export class RetryRunHandler implements SlackHandler {
  private readonly logger = new Logger(RetryRunHandler.name);

  constructor(
    private readonly replayFailedRunUsecase: ReplayFailedRunUsecase,
    private readonly humanizeService: HumanizeService,
  ) {}

  register(app: App): void {
    app.command('/retry-run', async ({ ack, command, respond }) => {
      const idText = command.text?.trim() ?? '';
      const id = Number(idText);
      if (!idText || !Number.isInteger(id) || id <= 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/retry-run <id>` (예: `/retry-run 42`)',
        });
        return;
      }
      await ack({
        response_type: 'ephemeral',
        text: `이대리가 run #${id} 를 재실행하는 중입니다...`,
      });

      const prepared = await this.replayFailedRunUsecase.prepare({
        runId: id,
        requesterSlackUserId: command.user_id,
      });
      if (prepared.kind === 'REJECTED') {
        await respond({
          response_type: 'ephemeral',
          // 실행 기록 자체를 못 찾은 경우와 처음 보는 종류는 종전대로 진행 문구를 덮지 않는다.
          ...(KEEP_ORIGINAL_ON_REJECTION.has(prepared.code)
            ? {}
            : { replace_original: true }),
          text: prepared.message,
        });
        return;
      }
      await this.respondReplay(prepared, respond);
    });
  }

  // 결과 모양이 종류마다 달라 포맷만 종류별로 고른다. 실행 자체는 `prepared.run()` 이 한다.
  private async respondReplay(
    prepared: PreparedReplay,
    respond: RespondFn,
  ): Promise<void> {
    const id = prepared.runId;
    switch (prepared.agentType) {
      case 'PM':
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: '/retry-run(PM)',
          execute: prepared.run,
          format: (result) =>
            formatDailyPlan(result.plan, result.inputTruncation),
        });
        return;
      case 'WORK_REVIEWER':
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: '/retry-run(WORK_REVIEWER)',
          execute: prepared.run,
          format: formatDailyReview,
        });
        return;
      case 'CODE_REVIEWER': {
        const prRef = prepared.prRef;
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: '/retry-run(CODE_REVIEWER)',
          execute: prepared.run,
          format: (review) => formatPullRequestReview({ prRef, review }),
        });
        return;
      }
      case 'IMPACT_REPORTER':
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: '/retry-run(IMPACT_REPORTER)',
          execute: prepared.run,
          format: formatImpactReport,
        });
        return;
      case 'PO_SHADOW':
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: `/retry-run#${id} (PO_SHADOW)`,
          execute: prepared.run,
          format: formatPoShadowReport,
        });
        return;
      case 'PO_EVAL':
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: `/retry-run#${id} (PO_EVAL)`,
          execute: prepared.run,
          format: async (result) =>
            formatEvaluationOutput(
              await humanizeEvaluationOutput(result, this.humanizeService),
            ),
        });
        return;
      case 'CEO':
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: `/retry-run#${id} (CEO)`,
          execute: prepared.run,
          format: formatCeoMetaOutput,
        });
        return;
      case 'VIDEO_WATCH': {
        const videoId = prepared.videoId;
        let report: Awaited<ReturnType<typeof prepared.run>>['report'] | null =
          null;
        await runAgentCommand({
          respond,
          logger: this.logger,
          commandLabel: '/retry-run(VIDEO_WATCH)',
          execute: async () => {
            const outcome = await prepared.run();
            report = outcome.report;
            return outcome;
          },
          format: (result) =>
            formatVideoWatch(
              result,
              report ?? {
                title: null,
                videoId,
                frameCount: 0,
                transcriptSource: null,
              },
            ),
        });
        return;
      }
      case 'PAPER_RECOMMEND': {
        const strategy = prepared.strategy;
        await runEphemeral({
          respond,
          logger: this.logger,
          commandLabel: `/retry-run#${id} (PAPER_RECOMMEND)`,
          task: prepared.run,
          format: (result) => {
            const completed = result.completed[0];
            if (completed) {
              return `${completed.strategy} 추천 재실행 완료: PENDING 주문 ${completed.ordersCreated}건`;
            }
            return `${strategy} 추천 재실행 실패: ${result.failed[0]?.message ?? '알 수 없는 오류'}`;
          },
        });
        return;
      }
      case 'BLOG_PUBLISH': {
        const commandLabel = `/retry-run#${id} (BLOG_PUBLISH)`;
        try {
          await respondBlogPublishOutcome(respond, await prepared.run());
        } catch (error: unknown) {
          const rawMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `${commandLabel} 실패: ${rawMessage}`,
            error instanceof Error ? error.stack : undefined,
          );
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `이대리 ${commandLabel} 실패: ${toUserFacingErrorMessage(error)}`,
          });
        }
        return;
      }
    }
  }
}
