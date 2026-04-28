import { Inject, Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import {
  EvidenceInput,
  TriggerType,
} from '../../../agent-run/domain/agent-run.type';
import {
  PullRequestDetail,
  PullRequestDiff,
} from '../../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  PullRequestReview,
  ReviewPullRequestInput,
} from '../domain/code-reviewer.type';
import {
  PR_REVIEW_OUTCOME_REPOSITORY_PORT,
  PrReviewOutcomeRepositoryPort,
} from '../domain/port/pr-review-outcome.repository.port';
import { parsePrReference } from '../domain/pr-reference.parser';
import { CODE_REVIEWER_SYSTEM_PROMPT } from '../domain/prompt/code-reviewer-system.prompt';
import { parsePullRequestReview } from '../domain/prompt/pr-review.parser';

@Injectable()
export class ReviewPullRequestUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PR_REVIEW_OUTCOME_REPOSITORY_PORT)
    private readonly outcomeRepository: PrReviewOutcomeRepositoryPort,
  ) {}

  async execute({
    prRef,
    slackUserId,
  }: ReviewPullRequestInput): Promise<AgentRunOutcome<PullRequestReview>> {
    // INVALID_PR_REFERENCE 는 파싱 시점에 즉시 예외.
    const ref = parsePrReference(prRef);

    return this.agentRunService.execute({
      agentType: AgentType.CODE_REVIEWER,
      triggerType: TriggerType.SLACK_COMMAND_REVIEW_PR,
      inputSnapshot: {
        prRef,
        repo: ref.repo,
        pullNumber: ref.number,
        slackUserId,
      },
      evidence: this.buildInitialEvidence({ prRef, slackUserId }),
      run: async () => {
        const [detail, diff] = await Promise.all([
          this.githubClient.getPullRequest(ref),
          this.githubClient.getPullRequestDiff(ref),
        ]);

        const recentRejected = await this.outcomeRepository
          .findRecentRejected({ slackUserId, limit: 2 })
          .catch(
            () =>
              [] as Awaited<
                ReturnType<PrReviewOutcomeRepositoryPort['findRecentRejected']>
              >,
          );

        const negativeExamples =
          recentRejected.length > 0
            ? `\n\n[이 사용자가 과거에 무시한 리뷰 패턴 — 이런 코멘트는 피하세요]\n` +
              recentRejected
                .map((r) => `• ${r.comment ?? '(코멘트 없음)'}`)
                .join('\n')
            : '';

        const prompt = buildReviewPrompt({ detail, diff }) + negativeExamples;

        const completion = await this.modelRouter.route({
          agentType: AgentType.CODE_REVIEWER,
          request: {
            prompt,
            systemPrompt: CODE_REVIEWER_SYSTEM_PROMPT,
          },
        });

        const review = parsePullRequestReview(completion.text);

        return {
          result: review,
          modelUsed: completion.modelUsed,
          output: review as unknown as Record<string, unknown>,
        };
      },
    });
  }

  private buildInitialEvidence({
    prRef,
    slackUserId,
  }: {
    prRef: string;
    slackUserId: string;
  }): EvidenceInput[] {
    return [
      {
        sourceType: 'SLACK_COMMAND_REVIEW_PR',
        sourceId: slackUserId,
        payload: { prRef },
      },
    ];
  }
}

export const buildReviewPrompt = ({
  detail,
  diff,
}: {
  detail: PullRequestDetail;
  diff: PullRequestDiff;
}): string => {
  const truncatedNote = detail.changedFilesTruncated
    ? ` (잘림: 전체 ${detail.changedFilesTotalCount}개 중 ${detail.changedFiles.length}개만 노출)`
    : '';
  const diffNote = diff.truncated
    ? `\n\n(diff 가 ${diff.bytes} bytes 라 ${diff.diff.length} bytes 까지만 잘려서 전달됨 — 잘린 뒷부분은 모를 수 있음)`
    : '';

  return [
    `[PR 메타]`,
    `- repo: ${detail.repo}`,
    `- number: #${detail.number}`,
    `- title: ${detail.title}`,
    `- author: ${detail.authorLogin}`,
    `- branch: ${detail.headRef} → ${detail.baseRef}`,
    `- additions/deletions: +${detail.additions} / -${detail.deletions}`,
    `- changed files${truncatedNote}:`,
    ...detail.changedFiles.map((file) => `  - ${file}`),
    '',
    `[PR 본문]`,
    detail.body || '(없음)',
    '',
    `[diff]${diffNote}`,
    '```diff',
    diff.diff,
    '```',
  ].join('\n');
};
