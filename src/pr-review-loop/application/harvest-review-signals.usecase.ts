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
        truncated: reviewThreads.truncated,
      });
      if (
        thread?.isResolved &&
        (signal.kind === 'NONE' || signal.kind === 'STALE')
      ) {
        // PR 이 종료된 채 결론 없이 끝난 카드는 STALE 로 남긴다. OPEN 인 채 resolvedAt 만
        // 채우면 다음 회차부터 조회 대상에서 빠지므로(status='OPEN' AND resolvedAt IS NULL)
        // "아직 안 봄" 과 "결론 없이 끝남" 이 영원히 구분되지 않는다.
        // 채택/기각 결론이 난 카드는 이 분기에 오지 않아 결론을 덮을 위험이 없다.
        if (signal.kind === 'STALE') {
          // 상태와 닫힘을 한 번의 쓰기로. 나눠 쓰면 사이에서 실패했을 때 부분 상태가
          // 고착되고(status 가 STALE 이라 재조회 안 됨) 남은 갱신을 재시도할 수 없다.
          await this.repository.markDecided({
            id: card.id,
            status: 'STALE',
            rejectReason: null,
            githubThreadNodeId: thread.threadId,
            resolveThread: true,
          });
          outcome.stale += 1;
        } else {
          await this.repository.markThreadResolved(card.id);
        }
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

    // judged 는 "LLM 판정으로 실제 결정된 건수" 다. 판정기는 입력 전건에 대해 결과를
    // 돌려주므로(실패분은 UNCLEAR) judgments.length 를 그대로 더하면 시도 건수가 되고,
    // UNCLEAR 는 아래에서 skipped 로도 세어져 같은 카드가 두 번 집계된다.
    const byId = new Map(judgments.map((judgment) => [judgment.id, judgment]));
    for (const pending of pendingJudgments) {
      const judgment = byId.get(pending.card.id);
      if (!judgment || judgment.verdict === 'UNCLEAR') {
        outcome.skipped += 1;
        continue;
      }
      outcome.judged += 1;
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
    if (status === 'REJECTED') {
      // 학습 신호를 먼저 적재한다. 카드를 REJECTED 로 확정한 뒤 적재하면, 실패했을 때
      // 카드가 다음 회차 조회(OPEN 만)에서 빠져 재시도할 길이 없다 — 이 루프가 존재하는
      // 이유가 바로 그 신호다. 확정을 미루면 다음 스윕이 같은 반응을 다시 읽어 재시도한다.
      const recorded = await this.recordRejectEpisode({
        card,
        reason: rejectReason,
      });
      if (!recorded) {
        outcome.skipped += 1;
        return;
      }
    }

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
    await this.repository.markThreadResolved(card.id);
    outcome.resolved += 1;
  }

  // 적재에 성공했는지. false 면 호출부가 카드를 확정하지 않고 OPEN 으로 남겨
  // 다음 회차에 재시도하게 한다.
  private async recordRejectEpisode({
    card,
    reason,
  }: {
    card: PrReviewFindingRecord;
    reason: string | null;
  }): Promise<boolean> {
    if (!this.episodicMemory) {
      // 적재 대상 자체가 없는 구성 — 확정을 막을 이유가 없다.
      return true;
    }
    const content =
      reason && reason.length > 0
        ? `${card.body}\n(기각 이유: ${reason})`
        : card.body;
    try {
      await this.episodicMemory.record({
        kind: 'pr_review',
        agentType: 'CODE_REVIEWER',
        agentRunId: card.agentRunId,
        content,
        occurredAt: new Date(),
      });
      return true;
    } catch (error: unknown) {
      this.logger.error(
        `PR 리뷰 기각 학습 신호 적재 실패 (카드 ${card.id}) — 확정을 미루고 다음 회차에 재시도: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
