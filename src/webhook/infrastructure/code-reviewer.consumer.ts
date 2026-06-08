import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { formatModelFooter } from '../../slack/format/model-footer.formatter';
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
export class WebhookCodeReviewerConsumer extends WorkerHost {
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
      // model + agentRunId footer 는 별도 helper 로 append (수동 /review-pr 동일 패턴).
      const text =
        formatPullRequestReview({
          prRef,
          review: outcome.result,
        }) + formatModelFooter(outcome);
      await this.slackService.postMessage({ target: slackUserId, text });
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
