import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JudgeReviewReplyUsecase } from '../../agent/review-reply-judge/application/judge-review-reply.usecase';
import { ReviewReplyJudgment } from '../../agent/review-reply-judge/domain/review-reply-judge.type';
import {
  EPISODIC_MEMORY_PORT,
  EpisodicMemoryPort,
} from '../../episodic-memory/domain/port/episodic-memory.port';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  ReviewThread,
} from '../../github/domain/port/github-client.port';
import { HarvestOutcome } from '../domain/harvest-outcome.type';
import {
  findThreadForComment,
  resolveHarvestSignal,
} from '../domain/harvest-signal';
import {
  PR_REVIEW_FINDING_REPOSITORY_PORT,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import {
  FindingStatus,
  PrReviewFindingRecord,
} from '../domain/pr-review-finding.type';

interface PullRequestCardGroup {
  repo: string;
  pullNumber: number;
  cards: PrReviewFindingRecord[];
}

interface PendingJudgment {
  card: PrReviewFindingRecord;
  thread: ReviewThread;
  replyBody: string;
}

const emptyOutcome = (): HarvestOutcome => ({
  acked: 0,
  rejected: 0,
  stale: 0,
  resolved: 0,
  judged: 0,
  skipped: 0,
});

@Injectable()
export class HarvestReviewSignalsUsecase {
  private readonly logger = new Logger(HarvestReviewSignalsUsecase.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly repository: PrReviewFindingRepositoryPort,
    private readonly judgeReviewReply: JudgeReviewReplyUsecase,
    @Optional()
    @Inject(EPISODIC_MEMORY_PORT)
    private readonly episodicMemory?: EpisodicMemoryPort,
  ) {}

  async execute(): Promise<HarvestOutcome> {
    const outcome = emptyOutcome();
    if (
      this.configService.get<string>('PR_REVIEW_HARVEST_ENABLED') !== 'true'
    ) {
      return outcome;
    }
    const ownerLogin = this.configService.get<string>(
      'GITHUB_WEBHOOK_OWNER_LOGIN',
    );
    if (!ownerLogin) {
      this.logger.warn(
        'PR 리뷰 수확 생략 — GITHUB_WEBHOOK_OWNER_LOGIN 미설정.',
      );
      return outcome;
    }

    const cards = await this.repository.findOpenPostedCards();
    const groups = this.groupCards(cards);
    for (const group of groups) {
      try {
        await this.harvestGroup({ group, ownerLogin, outcome });
      } catch (error: unknown) {
        outcome.skipped += group.cards.length;
        this.logger.warn(
          `PR 리뷰 수확 실패 (${group.repo}#${group.pullNumber}) — 다음 PR 계속: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return outcome;
  }

  private groupCards(cards: PrReviewFindingRecord[]): PullRequestCardGroup[] {
    const byPullRequest = new Map<string, PullRequestCardGroup>();
    for (const card of cards) {
      const key = `${card.repo}#${card.pullNumber}`;
      const found = byPullRequest.get(key);
      if (found) {
        found.cards.push(card);
        continue;
      }
      byPullRequest.set(key, {
        repo: card.repo,
        pullNumber: card.pullNumber,
        cards: [card],
      });
    }
    return Array.from(byPullRequest.values());
  }

  private async harvestGroup({
    group,
    ownerLogin,
    outcome,
  }: {
    group: PullRequestCardGroup;
    ownerLogin: string;
    outcome: HarvestOutcome;
  }): Promise<void> {
    const reviewThreads = await this.githubClient.listReviewThreads({
      repo: group.repo,
      number: group.pullNumber,
    });
    const pendingJudgments: PendingJudgment[] = [];

    for (const card of group.cards) {
      const thread =
        card.githubCommentId === null
          ? null
          : findThreadForComment(reviewThreads.threads, card.githubCommentId);
      const signal = resolveHarvestSignal({
        card,
        thread,
        ownerLogin,
        pullRequestState: reviewThreads.pullRequestState,
      });
      if (
        thread?.isResolved &&
        (signal.kind === 'NONE' || signal.kind === 'STALE')
      ) {
        await this.repository.markResolved(card.id);
        outcome.resolved += 1;
        continue;
      }

      switch (signal.kind) {
        case 'ACKED':
          if (thread === null) {
            outcome.skipped += 1;
            break;
          }
          await this.markDecisionAndResolve({
            card,
            thread,
            status: 'ACKED',
            rejectReason: null,
            outcome,
          });
          break;
        case 'REJECTED':
          if (thread === null) {
            outcome.skipped += 1;
            break;
          }
          await this.markDecisionAndResolve({
            card,
            thread,
            status: 'REJECTED',
            rejectReason: signal.replyBody,
            outcome,
          });
          break;
        case 'STALE':
          await this.repository.markDecided({
            id: card.id,
            status: 'STALE',
            rejectReason: null,
            githubThreadNodeId: thread?.threadId ?? null,
          });
          outcome.stale += 1;
          break;
        case 'NEEDS_JUDGE':
          if (thread === null) {
            outcome.skipped += 1;
            break;
          }
          pendingJudgments.push({
            card,
            thread,
            replyBody: signal.replyBody,
          });
          break;
        case 'NONE':
          outcome.skipped += 1;
          break;
      }
    }

    await this.judgeReplies({ pendingJudgments, outcome });
  }

  private async judgeReplies({
    pendingJudgments,
    outcome,
  }: {
    pendingJudgments: PendingJudgment[];
    outcome: HarvestOutcome;
  }): Promise<void> {
    if (pendingJudgments.length === 0) {
      return;
    }

    let judgments: ReviewReplyJudgment[];
    try {
      judgments = await this.judgeReviewReply.execute({
        items: pendingJudgments.map(({ card, replyBody }) => ({
          id: card.id,
          body: card.body,
          replyBody,
        })),
      });
    } catch (error: unknown) {
      outcome.skipped += pendingJudgments.length;
      this.logger.warn(
        `PR 리뷰 답글 판정 실패 — 답글 ${pendingJudgments.length}건 미결 유지: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    outcome.judged += judgments.length;
    const byId = new Map(judgments.map((judgment) => [judgment.id, judgment]));
    for (const pending of pendingJudgments) {
      const judgment = byId.get(pending.card.id);
      if (!judgment || judgment.verdict === 'UNCLEAR') {
        outcome.skipped += 1;
        continue;
      }
      await this.markDecisionAndResolve({
        card: pending.card,
        thread: pending.thread,
        status: judgment.verdict === 'ACCEPTED' ? 'ACKED' : 'REJECTED',
        rejectReason: judgment.verdict === 'REJECTED' ? judgment.reason : null,
        outcome,
      });
    }
  }

  private async markDecisionAndResolve({
    card,
    thread,
    status,
    rejectReason,
    outcome,
  }: {
    card: PrReviewFindingRecord;
    thread: ReviewThread;
    status: Extract<FindingStatus, 'ACKED' | 'REJECTED'>;
    rejectReason: string | null;
    outcome: HarvestOutcome;
  }): Promise<void> {
    await this.repository.markDecided({
      id: card.id,
      status,
      rejectReason,
      githubThreadNodeId: thread.threadId,
    });
    if (status === 'ACKED') {
      outcome.acked += 1;
    } else {
      outcome.rejected += 1;
      this.recordRejectEpisode({ card, reason: rejectReason });
    }

    if (!thread.isResolved) {
      try {
        await this.githubClient.resolveReviewThread(thread.threadId);
      } catch (error: unknown) {
        this.logger.warn(
          `PR 리뷰 스레드 resolve 실패 (${thread.threadId}) — 결정 상태 유지: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    }
    await this.repository.markResolved(card.id);
    outcome.resolved += 1;
  }

  private recordRejectEpisode({
    card,
    reason,
  }: {
    card: PrReviewFindingRecord;
    reason: string | null;
  }): void {
    if (!this.episodicMemory) {
      return;
    }
    const content =
      reason && reason.length > 0
        ? `${card.body}\n(기각 이유: ${reason})`
        : card.body;
    void this.episodicMemory
      .record({
        kind: 'pr_review',
        agentType: 'CODE_REVIEWER',
        agentRunId: card.agentRunId,
        content,
        occurredAt: new Date(),
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `PR 리뷰 reject episodic 적재 실패 (swallow): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}
