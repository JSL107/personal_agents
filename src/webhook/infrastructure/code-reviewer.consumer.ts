import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ObservedWorkerHost } from '../../common/queue/observed-worker-host';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { formatRunIdLine } from '../../common/util/run-id-line.util';
import { formatAiHandoff } from '../../notification/domain/incident-message';
import { formatPullRequestReview } from '../../slack/format/pull-request-review.formatter';
import { SlackService } from '../../slack/slack.service';
import {
  CODE_REVIEWER_QUEUE,
  CodeReviewerJobData,
} from '../domain/webhook.type';

// pull_request.opened webhook → 본인 PR 자동 /review-pr.
// concurrency=1 — LLM 동시 호출 방지 (다른 consumer 와 동일).
// 결과는 owner Slack DM 으로 발송 (PR comment X — Slack thread 중심 운영).
@Processor(CODE_REVIEWER_QUEUE, {
  concurrency: 1,
  ...LONG_RUNNING_WORKER_OPTIONS,
})
export class WebhookCodeReviewerConsumer extends ObservedWorkerHost {
  private readonly logger = new Logger(WebhookCodeReviewerConsumer.name);

  constructor(
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly slackService: SlackService,
  ) {
    super();
  }

  async process(job: Job<CodeReviewerJobData>): Promise<void> {
    const { prRef, slackUserId } = job.data;
    this.logger.log(`Webhook code-reviewer 시작 — ${prRef}`);
    try {
      const outcome = await this.reviewPullRequestUsecase.execute({
        prRef,
        slackUserId,
        triggerType: TriggerType.WEBHOOK,
      });
      // AgentRunOutcome<PullRequestReview>.result 가 review 본체 — formatter 가 받는 type.
      const text = formatPullRequestReview({
        prRef,
        prTitle: outcome.prTitle,
        review: outcome.result,
      });
      const withRunId = `${text}\n${formatRunIdLine(outcome.agentRunId)}`;
      const posted = await this.slackService.postMessage({
        kind: 'code-review-webhook',
        target: slackUserId,
        text: withRunId,
      });
      const review = outcome.result;
      const findings = [
        ...review.mustFix,
        ...review.niceToHave,
        ...review.missingTests,
        ...review.reviewCommentDrafts.map((draft) => draft.body),
        ...review.findings.map((finding) => finding.body),
      ];
      if (findings.length > 0) {
        const files = [
          ...review.reviewCommentDrafts,
          ...review.findings,
        ].flatMap((finding) =>
          finding.file
            ? [`${finding.file}${finding.line ? `:${finding.line}` : ''}`]
            : [],
        );
        const match = /^([^#]+)#(\d+)$/.exec(prRef);
        const link = match
          ? `https://github.com/${match[1]}/pull/${match[2]}`
          : prRef;
        const handoff = formatAiHandoff({
          feature: `${link} ${outcome.prTitle ?? review.summary}`,
          errorMessage: [...new Set(findings)].join('\n'),
          files: [...new Set(files)],
          checkCommand: null,
        });
        try {
          await this.slackService.postMessage({
            kind: 'code-review-webhook',
            target: slackUserId,
            ...(posted.ts ? { threadTs: posted.ts } : {}),
            text: handoff,
          });
        } catch (error: unknown) {
          try {
            await this.slackService.postMessage({
              kind: 'code-review-webhook',
              target: slackUserId,
              text: handoff,
            });
          } catch (fallbackError: unknown) {
            this.logger.error(
              `Webhook code-reviewer AI 블록 전송 실패: ${String(error)}; ${String(fallbackError)}`,
            );
          }
        }
      }
      this.logger.log(
        `Webhook code-reviewer 완료 — ${prRef} (agentRunId=${outcome.agentRunId})`,
      );
    } catch (error: unknown) {
      // BAD_REQUEST (INVALID_PR_REFERENCE 등) 은 영구 실패 → swallow.
      if (
        error instanceof DomainException &&
        error.status === DomainStatus.BAD_REQUEST
      ) {
        this.logger.warn(`Webhook code-reviewer skip — ${error.message}`);
        return;
      }
      this.logger.error(
        `Webhook code-reviewer 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
