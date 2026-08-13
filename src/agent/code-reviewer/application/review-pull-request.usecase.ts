import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { PublishFindingsService } from '../../../pr-review-loop/application/publish-findings.service';
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
import {
  buildRepoConventions,
  CODE_REVIEWER_SYSTEM_PROMPT,
} from '../domain/prompt/code-reviewer-system.prompt';
import { parsePullRequestReview } from '../domain/prompt/pr-review.parser';

const DEFAULT_INLINE_MAX = 4;

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
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    @Inject(PublishFindingsService)
    private readonly publishFindingsService?: PublishFindingsService,
  ) {}

  async execute({
    prRef,
    slackUserId,
    triggerType,
    conversationContext,
    snapshot,
    dryRun,
    publish,
  }: ReviewPullRequestInput): Promise<AgentRunOutcome<PullRequestReview>> {
    // INVALID_PR_REFERENCE 는 파싱 시점에 즉시 예외.
    const ref = parsePrReference(prRef);
    const effectiveTriggerType =
      triggerType ?? TriggerType.SLACK_COMMAND_REVIEW_PR;
    let reviewedDetail: PullRequestDetail | undefined;
    let reviewedDiff: PullRequestDiff | undefined;

    const outcome = await this.agentRunService.execute({
      agentType: AgentType.CODE_REVIEWER,
      triggerType: effectiveTriggerType,
      inputSnapshot: {
        prRef,
        repo: ref.repo,
        pullNumber: ref.number,
        slackUserId,
        // 스윕 경로만 채운다 — findLatestSweepReview 가 읽는 판정 근거.
        ...(dryRun === undefined ? {} : { dryRun }),
        // 게시 의도를 스냅샷에 남긴다. /retry-run 은 이 스냅샷만 보고 재실행하므로,
        // 남기지 않으면 최초에 게시하기로 한 리뷰가 재실행에서 조용히 미게시로 빠진다.
        // 스윕은 publish 를 넘기지 않아 키 자체가 없고, 재실행도 종전대로 미게시다.
        ...(publish === undefined ? {} : { publish }),
      },
      evidence: this.buildInitialEvidence({
        prRef,
        slackUserId,
        triggerType: effectiveTriggerType,
      }),
      run: async () => {
        // 호출자가 이미 조회한 스냅샷이 있으면 그대로 쓴다 — 리뷰와 후속 게시가 같은
        // headSha·diff 를 보게 하고, GitHub API 왕복도 줄인다.
        const [detail, diff] = snapshot
          ? [snapshot.detail, snapshot.diff]
          : await Promise.all([
              this.githubClient.getPullRequest(ref),
              this.githubClient.getPullRequestDiff(ref),
            ]);
        reviewedDetail = detail;
        reviewedDiff = diff;

        const negativeExamples = await this.buildNegativeExamples({
          slackUserId,
          detail,
        });

        // 규약은 diff 뒤(negative example 과 같은 자리)에 붙인다 — "이건 지적하지 말라" 류
        // 지시는 diff 를 다 읽은 뒤 마지막에 있는 편이 긴 컨텍스트에서 덜 묻힌다.
        const prompt =
          buildReviewPrompt({ detail, diff, conversationContext }) +
          buildRepoConventions(detail.repo) +
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

    if (
      publish === true &&
      this.publishFindingsService !== undefined &&
      reviewedDetail !== undefined &&
      reviewedDiff !== undefined
    ) {
      try {
        await this.publishFindingsService.publish({
          agentRunId: outcome.agentRunId,
          repo: ref.repo,
          pullNumber: ref.number,
          headSha: reviewedDetail.headSha,
          diff: reviewedDiff.diff,
          findings: outcome.result.findings,
          max: this.inlineMax(),
          dryRun: false,
          allowlistRaw: this.configService?.get<string>(
            'PR_REVIEW_INLINE_REPOS',
          ),
        });
      } catch (error: unknown) {
        this.logger.warn(
          `PR 리뷰 게시 실패 (${ref.repo}#${ref.number}), 리뷰 결과는 유지: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return outcome;
  }

  private inlineMax(): number {
    const raw = this.configService?.get<string>('PR_REVIEW_INLINE_MAX');
    if (raw === undefined || raw.trim().length === 0) {
      return DEFAULT_INLINE_MAX;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return DEFAULT_INLINE_MAX;
    }
    return parsed;
  }

  private buildInitialEvidence({
    prRef,
    slackUserId,
    triggerType,
  }: {
    prRef: string;
    slackUserId: string;
    triggerType: TriggerType;
  }): EvidenceInput[] {
    return [
      {
        sourceType: triggerType,
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
