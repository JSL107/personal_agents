import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { InferIssueLabelsUsecase } from '../../agent/issue-labeler/application/infer-issue-labels.usecase';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { ISSUE_LABEL_QUEUE, IssueLabelJobData } from '../domain/webhook.type';

// issues.opened webhook 자동 라벨링 — repo label vocab fetch → LLM 분류 → octokit addLabels.
// concurrency=1: LLM CLI 동시 spawn 폭주 방지 (기존 impact-report consumer 와 동일 정책).
// 실패 시 BullMQ retry — addLabels 호출 자체 멱등 (이미 붙은 label 은 noop).
@Processor(ISSUE_LABEL_QUEUE, {
  concurrency: 1,
  ...LONG_RUNNING_WORKER_OPTIONS,
})
export class WebhookIssueLabelConsumer extends WorkerHost {
  private readonly logger = new Logger(WebhookIssueLabelConsumer.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly inferIssueLabelsUsecase: InferIssueLabelsUsecase,
  ) {
    super();
  }

  async process(job: Job<IssueLabelJobData>): Promise<void> {
    const { repo, issueNumber, title, body } = job.data;
    const ref = `${repo}#${issueNumber}`;
    this.logger.log(`Webhook issue-label 시작 — ${ref}`);

    let availableLabels;
    try {
      availableLabels = await this.githubClient.listRepoLabels(repo);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Webhook issue-label ${ref} — vocab 조회 실패: ${message}`,
      );
      throw error;
    }

    if (availableLabels.length === 0) {
      this.logger.warn(
        `Webhook issue-label ${ref} — repo 에 label 없음 — skip.`,
      );
      return;
    }

    const outcome = await this.inferIssueLabelsUsecase.execute({
      repo,
      issueNumber,
      title,
      body,
      availableLabels,
    });

    if (outcome.result.labels.length === 0) {
      this.logger.log(
        `Webhook issue-label ${ref} — LLM 이 적합 label 없다고 판단 (reasoning: ${outcome.result.reasoning}). addLabels skip.`,
      );
      return;
    }

    await this.githubClient.addLabelsToIssue({
      repo,
      issueNumber,
      labels: outcome.result.labels,
    });
    this.logger.log(
      `Webhook issue-label 완료 — ${ref} (labels=[${outcome.result.labels.join(', ')}])`,
    );
  }
}
