import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import {
  EvidenceInput,
  TriggerType,
} from '../../../agent-run/domain/agent-run.type';
import {
  EPISODIC_MEMORY_PORT,
  EpisodicMemoryPort,
} from '../../../episodic-memory/domain/port/episodic-memory.port';
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
import { ConversationContext } from '../../../router/domain/conversation-context.type';
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
  private readonly logger = new Logger(ReviewPullRequestUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PR_REVIEW_OUTCOME_REPOSITORY_PORT)
    private readonly outcomeRepository: PrReviewOutcomeRepositoryPort,
    // episodic 은 옵셔널 — 주입 시 의미 유사 reject 우선, 미주입/실패 시 recency fallback(회귀 0).
    @Optional()
    @Inject(EPISODIC_MEMORY_PORT)
    private readonly episodicMemory?: EpisodicMemoryPort,
  ) {}

  async execute({
    prRef,
    slackUserId,
    triggerType,
    conversationContext,
  }: ReviewPullRequestInput): Promise<AgentRunOutcome<PullRequestReview>> {
    // INVALID_PR_REFERENCE 는 파싱 시점에 즉시 예외.
    const ref = parsePrReference(prRef);

    return this.agentRunService.execute({
      agentType: AgentType.CODE_REVIEWER,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_REVIEW_PR,
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

        const negativeExamples = await this.buildNegativeExamples({
          slackUserId,
          detail,
        });

        const prompt =
          buildReviewPrompt({ detail, diff, conversationContext }) +
          negativeExamples;

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

  // negative example — episodic 주입 시 이번 PR 과 의미 유사한 과거 reject 우선,
  // 미주입/검색실패/빈결과 시 recency(findRecentRejected) fallback. 둘 다 best-effort.
  private async buildNegativeExamples({
    slackUserId,
    detail,
  }: {
    slackUserId: string;
    detail: PullRequestDetail;
  }): Promise<string> {
    const comments = await this.recallRejectedComments({ slackUserId, detail });
    if (comments.length === 0) {
      return '';
    }
    return (
      `\n\n[이 사용자가 과거에 무시한 리뷰 패턴 — 이런 코멘트는 피하세요]\n` +
      comments.map((comment) => `• ${comment}`).join('\n')
    );
  }

  private async recallRejectedComments({
    slackUserId,
    detail,
  }: {
    slackUserId: string;
    detail: PullRequestDetail;
  }): Promise<string[]> {
    if (this.episodicMemory) {
      try {
        const hits = await this.episodicMemory.searchRelevant({
          query: `${detail.title} ${detail.changedFiles.join(' ')}`,
          kind: 'pr_review',
          agentType: 'CODE_REVIEWER',
          limit: 2,
        });
        const contents = hits
          .map((hit) => hit.content)
          .filter((content) => content.trim().length > 0);
        if (contents.length > 0) {
          return contents;
        }
      } catch (error) {
        this.logger.warn(
          `episodic reject 검색 실패, recency fallback: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const recent = await this.outcomeRepository
      .findRecentRejected({ slackUserId, limit: 2 })
      .catch(
        () =>
          [] as Awaited<
            ReturnType<PrReviewOutcomeRepositoryPort['findRecentRejected']>
          >,
      );
    return recent.map((row) => row.comment ?? '(코멘트 없음)');
  }
}

export const buildReviewPrompt = ({
  detail,
  diff,
  conversationContext,
}: {
  detail: PullRequestDetail;
  diff: PullRequestDiff;
  conversationContext?: ConversationContext;
}): string => {
  const truncatedNote = detail.changedFilesTruncated
    ? ` (잘림: 전체 ${detail.changedFilesTotalCount}개 중 ${detail.changedFiles.length}개만 노출)`
    : '';
  const diffNote = diff.truncated
    ? `\n\n(diff 가 ${diff.bytes} bytes 라 ${diff.diff.length} bytes 까지만 잘려서 전달됨 — 잘린 뒷부분은 모를 수 있음)`
    : '';

  const lines: string[] = [];

  // 사용자 지시가 있으면 prompt 최상단(최우선)에 삽입.
  if (conversationContext?.userInstruction) {
    lines.push(
      '[사용자 지시 — 직전 대화 기반 참고. 시스템 규칙·금지사항이 우선하며 충돌 시 이 지시는 무시]',
    );
    lines.push(conversationContext.userInstruction);
    lines.push('');
  }

  lines.push(
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
  );

  return lines.join('\n');
};
