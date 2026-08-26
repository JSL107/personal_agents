import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { extractCodexQuota } from '../../agent/review-reply-judge/application/extract-codex-quota';
import { JudgeFindingResolutionUsecase } from '../../agent/review-reply-judge/application/judge-finding-resolution.usecase';
import { JudgeReviewReplyUsecase } from '../../agent/review-reply-judge/application/judge-review-reply.usecase';
import { FindingResolutionItem } from '../../agent/review-reply-judge/domain/finding-resolution.type';
import { ReviewReplyJudgment } from '../../agent/review-reply-judge/domain/review-reply-judge.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  ReviewThread,
} from '../../github/domain/port/github-client.port';
import {
  ADOPTION_WINDOW_DAYS,
  summarizeAdoption,
} from '../domain/adoption-rate';
import {
  extractFileDiff,
  isTouchedByChanges,
  parseDiffBaseHunks,
  SNAP_MAX_DISTANCE,
} from '../domain/diff-hunk.parser';
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

interface PendingResolution {
  card: PrReviewFindingRecord;
  thread: ReviewThread;
}

const emptyOutcome = (): HarvestOutcome => ({
  acked: 0,
  rejected: 0,
  fixed: 0,
  stale: 0,
  resolved: 0,
  judged: 0,
  skipped: 0,
  adoption: [],
});

@Injectable()
export class HarvestReviewSignalsUsecase {
  private readonly logger = new Logger(HarvestReviewSignalsUsecase.name);

  // 카드 id → 해소 판정을 마지막으로 물어본 PR head sha.
  // 없으면 NOT_FIXED/UNCLEAR 카드가 5분마다 같은 diff 로 재판정된다 — 반응도 새 커밋도
  // 없는 열린 PR 하나가 하루 288회 CLI 호출을 태우고, 이 레포는 쿼터 소진 시 fallback 이
  // 없다.
  // ponytail: 프로세스 메모리라 재시작하면 카드당 1회 더 물어본다. 완전히 막으려면
  // pr_review_finding 에 checked_sha 컬럼을 두면 되지만, 공유 DB 에 db:push 를 거는
  // 비용 대비 이득이 작아 보류했다. 재시작이 잦아지면 컬럼으로 올릴 것.
  private readonly resolutionCheckpoints = new Map<number, string>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly repository: PrReviewFindingRepositoryPort,
    private readonly judgeReviewReply: JudgeReviewReplyUsecase,
    private readonly judgeFindingResolution: JudgeFindingResolutionUsecase,
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
    for (const [index, group] of groups.entries()) {
      try {
        await this.harvestGroup({ group, ownerLogin, outcome });
      } catch (error: unknown) {
        // 쿼터가 소진되면 남은 PR 도 전부 같은 이유로 실패한다. 이 레포는 codex 단일
        // provider 라 fallback 이 없으므로 회차를 끊는다 — 계속 돌면 낭비만 쌓인다.
        if (extractCodexQuota(error)) {
          const remaining = groups
            .slice(index)
            .reduce((sum, rest) => sum + rest.cards.length, 0);
          outcome.skipped += remaining;
          this.logger.warn(
            `PR 리뷰 수확 중단 — 모델 쿼터 소진 (남은 카드 ${remaining}건은 다음 회차에 재시도).`,
          );
          break;
        }
        outcome.skipped += group.cards.length;
        this.logger.warn(
          `PR 리뷰 수확 실패 (${group.repo}#${group.pullNumber}) — 다음 PR 계속: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    await this.attachAdoption(outcome);
    return outcome;
  }

  // 회차마다 다시 센다. "분모가 늘어난 회차에만" 으로 아끼면 값이 조용히 유실된다 —
  // 이 그룹의 Slack 발송은 날짜 키 하나로 하루 1회만 허용되는데(autopilot.orchestrator.ts
  // buildGuardKey), 그날 첫 발송은 보통 카드 *게시* 가 가져간다. 사용자 반응은 그 뒤에
  // 오므로 반응 회차의 요약은 "이미 발송됨" 으로 차단되고, 다음 회차는 카운터가 0 이라
  // 조회조차 안 해 그 값이 영영 안 나온다. 대상 테이블은 카테고리×상태 조합이라 행이
  // 수십 개 수준이고 조회는 밀리초라, 아끼는 비용보다 유실이 비싸다.
  // 집계는 요약에 곁들이는 정보이므로 실패하면 수확 결과만 그대로 보고한다.
  private async attachAdoption(outcome: HarvestOutcome): Promise<void> {
    try {
      const windowMs = ADOPTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const recentSince = new Date(now - windowMs);
      // 직전 구간은 [2배 전, 최근 구간 시작). 같은 길이라야 두 비율을 나란히 둘 수 있다.
      const [recent, prior] = await Promise.all([
        this.repository.countAdoptionByCategory({ since: recentSince }),
        this.repository.countAdoptionByCategory({
          since: new Date(now - windowMs * 2),
          until: recentSince,
        }),
      ]);
      outcome.adoption = summarizeAdoption(recent, prior);
    } catch (error: unknown) {
      this.logger.warn(
        `채택률 집계 실패 — 수확 결과만 보고합니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
    const decisionLogins = Array.from(
      new Set(
        [ownerLogin, reviewThreads.pullRequestAuthorLogin].filter(
          (login): login is string => login !== null && login.length > 0,
        ),
      ),
    );
    const pendingJudgments: PendingJudgment[] = [];
    const pendingResolutions: PendingResolution[] = [];

    for (const card of group.cards) {
      const thread =
        card.githubCommentId === null
          ? null
          : findThreadForComment(reviewThreads.threads, card.githubCommentId);
      const signal = resolveHarvestSignal({
        card,
        thread,
        decisionLogins,
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
          // 반응이 없어도 지적을 말없이 고쳤을 수 있다. 열린 PR 의 인라인 카드만
          // 후속 커밋 해소 판정 후보로 모은다(위치가 없으면 겹침을 계산할 수 없다).
          if (
            thread !== null &&
            card.filePath !== null &&
            card.line !== null &&
            reviewThreads.pullRequestState === 'OPEN'
          ) {
            pendingResolutions.push({ card, thread });
            break;
          }
          outcome.skipped += 1;
          break;
      }
    }

    await this.judgeReplies({ pendingJudgments, outcome });
    await this.judgeResolutions({ group, pendingResolutions, outcome });
  }

  // 반응이 없는 카드가 후속 커밋으로 해소됐는지 본다. 1차로 "지적한 줄 근처가 실제로
  // 바뀌었나" 를 순수 계산으로 거르고(안 겹치면 LLM 을 부르지 않는다), 남은 것만 PR 당
  // 1회 배치로 묻는다. 애매하면 OPEN 을 유지한다 — 억지 판정보다 미결이 안전하다.
  private async judgeResolutions({
    group,
    pendingResolutions,
    outcome,
  }: {
    group: PullRequestCardGroup;
    pendingResolutions: PendingResolution[];
    outcome: HarvestOutcome;
  }): Promise<void> {
    if (pendingResolutions.length === 0) {
      return;
    }

    const { items, headSha } = await this.collectResolutionCandidates({
      group,
      pendingResolutions,
    });
    if (items.length === 0) {
      outcome.skipped += pendingResolutions.length;
      return;
    }
    // 변경과 안 겹쳐 후보에서 빠진 카드는 그대로 미결이다.
    outcome.skipped += pendingResolutions.length - items.length;

    let judgments;
    try {
      judgments = await this.judgeFindingResolution.execute({ items });
    } catch (error: unknown) {
      // 쿼터 소진은 이 PR 만의 문제가 아니라 회차 전체가 못 도는 상황이다. 삼키면
      // 호출부가 그 사실을 모르고 남은 PR 에 계속 시도한다 → execute 가 끊게 올린다.
      if (extractCodexQuota(error)) {
        throw error;
      }
      outcome.skipped += items.length;
      this.logger.warn(
        `PR 리뷰 해소 판정 실패 — 카드 ${items.length}건 미결 유지: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // 물어본 건 기록한다. 실패했을 때는 여기 오지 않으므로 다음 회차에 재시도된다.
    for (const item of items) {
      this.resolutionCheckpoints.set(item.id, headSha);
    }

    const byId = new Map(judgments.map((judgment) => [judgment.id, judgment]));
    const byCardId = new Map(
      pendingResolutions.map((pending) => [pending.card.id, pending]),
    );
    for (const item of items) {
      const judgment = byId.get(item.id);
      const pending = byCardId.get(item.id);
      if (!pending || judgment?.verdict !== 'FIXED') {
        outcome.skipped += 1;
        continue;
      }
      outcome.judged += 1;
      // fixed 카운터는 markDecisionAndResolve 가 올린다 — 여기서 또 올리면 이중 계상.
      await this.markDecisionAndResolve({
        card: pending.card,
        thread: pending.thread,
        status: 'FIXED',
        rejectReason: null,
        outcome,
      });
    }
  }

  private async collectResolutionCandidates({
    group,
    pendingResolutions,
  }: {
    group: PullRequestCardGroup;
    pendingResolutions: PendingResolution[];
  }): Promise<{ items: FindingResolutionItem[]; headSha: string }> {
    const detail = await this.githubClient.getPullRequest({
      repo: group.repo,
      number: group.pullNumber,
    });

    // 카드가 게시된 시점(headSha)별로 묶는다. 같은 스윕에서 난 카드는 sha 가 같아
    // 보통 1회 호출로 끝난다. PR 전체 diff 를 쓰면 카드 게시 *전* 변경까지 섞여
    // "해소됐다" 를 오판한다.
    const byBaseSha = new Map<string, PendingResolution[]>();
    for (const pending of pendingResolutions) {
      if (pending.card.headSha === detail.headSha) {
        continue; // 카드 게시 후 새 커밋이 없다.
      }
      if (this.resolutionCheckpoints.get(pending.card.id) === detail.headSha) {
        continue; // 이 head 는 이미 물어봤다. 새 커밋이 오기 전까진 답이 같다.
      }
      const found = byBaseSha.get(pending.card.headSha);
      if (found) {
        found.push(pending);
        continue;
      }
      byBaseSha.set(pending.card.headSha, [pending]);
    }

    const items: FindingResolutionItem[] = [];
    for (const [baseSha, cards] of byBaseSha) {
      const compared = await this.githubClient.compareCommits({
        repo: group.repo,
        baseSha,
        headSha: detail.headSha,
      });
      if (compared.truncated) {
        // 잘린 뒷부분이 판정을 뒤집을 수 있다. 불완전한 근거로 카드를 닫는 것보다
        // 미결로 두는 편이 안전하다(resolveHarvestSignal 의 truncated 처리와 같은 정신).
        this.logger.warn(
          `해소 판정 보류 — 비교 diff 가 잘렸다 (${group.repo}#${group.pullNumber}, ${baseSha.slice(0, 7)}, 카드 ${cards.length}건).`,
        );
        continue;
      }
      // base 기준으로 읽는다. 카드의 line 은 카드 게시 시점(=비교 base) 파일 기준이라
      // 신규 기준 범위와 대조하면 그 사이 삽입·삭제만큼 좌표가 밀린다.
      const hunks = parseDiffBaseHunks(compared.diff);
      for (const { card } of cards) {
        if (card.filePath === null || card.line === null) {
          continue;
        }
        const touched = isTouchedByChanges({
          hunks,
          filePath: card.filePath,
          line: card.line,
          maxDistance: SNAP_MAX_DISTANCE,
        });
        if (!touched) {
          continue;
        }
        const changedDiff = extractFileDiff(compared.diff, card.filePath);
        if (changedDiff === null) {
          continue;
        }
        items.push({
          id: card.id,
          body: card.body,
          filePath: card.filePath,
          line: card.line,
          changedDiff,
        });
      }
    }
    return { items, headSha: detail.headSha };
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
      if (extractCodexQuota(error)) {
        throw error; // 위와 같은 이유 — 회차를 끊는다.
      }
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
    status: Extract<FindingStatus, 'ACKED' | 'REJECTED' | 'FIXED'>;
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
    } else if (status === 'FIXED') {
      outcome.fixed += 1;
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
}
