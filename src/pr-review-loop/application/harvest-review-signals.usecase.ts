import { createHash } from 'node:crypto';

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
import { LEARNING_REPO } from '../domain/learning-repo';
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

// 👎 만 달리고 답글이 아직 없는 기각을 확정하기 전에 기다리는 시간.
// CLAUDE.md §8-1 이 "답변을 먼저, 👎 를 나중에" 를 운영 규칙으로 두지만 코드 방어가 없어
// 순서가 뒤집히면 기각 이유가 유실된다. 사람이 반박을 적는 데 걸리는 시간이라 넉넉히 잡는다.
const REJECTION_REPLY_GRACE_MS = 24 * 60 * 60 * 1000;

// 답글 판정 체크포인트의 키. 같은 답글을 다시 물어보지 않기 위한 것이라 답글 본문만 본다.
const replyFingerprint = (replyBody: string): string =>
  createHash('sha256').update(replyBody).digest('hex');

// 모델·사용자 문자열을 로그 한 줄로 누른다. 제어문자를 그대로 찍으면 로그 행을 위조하거나
// 터미널 escape 를 흘려보낼 수 있다.
const LOG_REASON_MAX = 120;
const flattenForLog = (text: string): string => {
  // eslint-disable-next-line no-control-regex -- 제어문자 제거가 본 패턴의 의도.
  const flattened = text.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
  return flattened.length > LOG_REASON_MAX
    ? `${flattened.slice(0, LOG_REASON_MAX)}…`
    : flattened;
};

interface PendingJudgment {
  card: PrReviewFindingRecord;
  thread: ReviewThread;
  // 판정기 입력 — 누가 무엇을 수용했는지는 스레드 전체를 봐야 정확하다.
  replyBody: string;
  // 규약 재료 — owner 가 쓴 답글만. 없으면 기각 이유를 남기지 않는다.
  ownerReplyBody: string | null;
  /**
   * 👎 리액션으로 이미 기각이 정해진 카드. 판정기가 "수용" 이라고 읽으면 둘 중 하나가
   * 틀린 것이므로 확정하지 않는다. 판정기를 새로 부르지 않고 기존 배치에 얹는다.
   */
  reactionRejected?: boolean;
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
  contradicted: 0,
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

  // 카드 id → 답글 판정을 마지막으로 물어본 답글 지문.
  // 없으면 UNCLEAR 판정이 난 카드가 status=OPEN 그대로 남아 5분마다 **같은 답글로**
  // 다시 판정된다("확인했습니다" 류가 전형). 해소 판정에는 위 checkpoint 가 있는데
  // 답글 판정에만 없었다 — 같은 비용 구조인데 가드가 한쪽에만 있었다.
  // ponytail: 프로세스 메모리라 재시작하면 카드당 1회 더 물어본다. 위 checkpoint 와
  // 같은 판단으로 컬럼까지는 만들지 않는다.
  private readonly replyJudgmentCheckpoints = new Map<number, string>();

  // 카드 id → 마지막으로 모순 판정에 넣은 답글 원문. 보류(contradicted)로 남은 카드는
  // OPEN 인 채 다음 회차에도 같은 signal 로 다시 걸린다 — 답글이 그대로면 재판정은
  // 매번 같은 결론만 확인하면서 쿼터만 태운다(스윕 */3, 카드 1건이 하루 최대 480회).
  // 위 resolutionCheckpoints 와 같은 패턴 — 답글이 바뀌면(사람이 정정) 그때만 다시 묻는다.
  private readonly contradictionCheckpoints = new Map<number, string>();

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
  //
  // 대상은 학습 규약이 실리는 레포 하나로 한정한다(`LEARNING_REPO`). 전 레포를 합산하면
  // 규약이 실리지도 않는 레포의 결론이 섞여 "규약을 실은 뒤 나아졌나" 에 답할 수 없다 —
  // 실측(2026-08-26)상 ARCHITECTURE 최근 14일 기각 4건 중 1건이 규약 미적용 레포였다.
  private async attachAdoption(outcome: HarvestOutcome): Promise<void> {
    try {
      const windowMs = ADOPTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const recentSince = new Date(now - windowMs);
      // 직전 구간은 [2배 전, 최근 구간 시작). 같은 길이라야 두 비율을 나란히 둘 수 있다.
      const [recent, prior] = await Promise.all([
        this.repository.countAdoptionByCategory({
          repo: LEARNING_REPO,
          since: recentSince,
        }),
        this.repository.countAdoptionByCategory({
          repo: LEARNING_REPO,
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
        case 'REJECTED': {
          if (thread === null) {
            outcome.skipped += 1;
            break;
          }
          // 답글·리액션이 페이지 상한에서 잘렸으면 수용 답글이 조회 밖에 있을 수 있다.
          // 잘못 확정하면 되돌릴 경로가 없으므로(확정 카드는 OPEN 전용 조회에서 빠진다)
          // 미결로 남긴다. truncated 는 PR 단위 플래그라(다른 스레드 하나가 상한을
          // 넘어도 참이 된다) 멀쩡한 스레드까지 매 회차 조용히 이 분기로 떨어질 수
          // 있다 — skip 카운터만으로는 사람이 알 길이 없어 경고를 남긴다.
          if (reviewThreads.truncated) {
            outcome.skipped += 1;
            this.logger.warn(
              `PR 리뷰 기각 보류 — 스레드 조회가 잘려 기각을 확정하지 않았다 (${group.repo}#${group.pullNumber}, 카드 ${card.id}).`,
            );
            break;
          }
          // 게이트는 owner 답글 유무로만 연다 — 규약이 될 수 있는 결정은 owner 것뿐이다
          // (`harvest-signal.ts` 의 `ownerLogin` 주석). PR 작성자만 답글을 단 경우는
          // 종전대로 리액션만으로 즉시 확정한다.
          if (signal.ownerReplyBody !== null) {
            // ownerReplyBody 가 있으면 그 문장은 항상 replyBody 에도 포함돼 있다
            // (도메인 불변식) — 그래도 타입은 별개라 null 대비 fallback 을 둔다.
            const replyBody = signal.replyBody ?? signal.ownerReplyBody;
            if (this.contradictionCheckpoints.get(card.id) === replyBody) {
              // 지난 회차에 이미 같은 답글로 모순 판정을 받았다. 답글이 안 바뀌었으면
              // 다시 물어도 같은 결론이라 재확인은 사람 몫으로 남긴다.
              outcome.contradicted += 1;
              break;
            }
            pendingJudgments.push({
              card,
              thread,
              replyBody,
              ownerReplyBody: signal.ownerReplyBody,
              reactionRejected: true,
            });
            break;
          }
          // 👎 만 있고 답글이 아직 없으면 이번 회차는 확정하지 않는다. 확정하면 status 가
          // OPEN 이 아니게 되어 다음 회차 조회에서 빠지고(`findOpenPostedCards`), 뒤늦게
          // 단 반박 답글은 영영 수확되지 않는다 — 이유 없는 기각은 길이 하한에 걸려
          // 규약 재료가 못 되므로(`MIN_REASON_LENGTH`) 학습 관점에서는 카드가 통째로
          // 사라지는 것과 같다. 실측(2026-07-31~09-09): REJECTED 40건 중 2건.
          // 유예가 지나도 답글이 없으면 그때는 지금처럼 이유 없이 확정한다 — 계속 미루면
          // PR 이 닫힐 때 STALE 로 끝나 기각 사실 자체가 사라진다.
          // reactedAt 이 파싱 불가면 waitedMs 는 NaN 이고 아래 비교가 false 라 바로
          // 확정된다 — 유예 전 동작 그대로다. 시각을 모르면 유예 상한도 걸 수 없고,
          // 무한 보류는 PR 이 닫힐 때 STALE 이 되어 기각 사실 자체를 지운다.
          const waitedMs = Date.now() - new Date(signal.reactedAt).getTime();
          // 기다리는 것은 **owner 답글**이다. 규약이 될 문장은 owner 가 쓴 것만 남기므로
          // (`rejectReason`), 제3자 답글이 먼저 달렸다고 유예를 끝내면 이유 없는 기각이
          // 그대로 확정된다 — 이 유예가 막으려는 바로 그 상황이다.
          if (
            signal.ownerReplyBody === null &&
            waitedMs < REJECTION_REPLY_GRACE_MS
          ) {
            outcome.skipped += 1;
            break;
          }
          await this.markDecisionAndResolve({
            card,
            thread,
            status: 'REJECTED',
            // 규약이 될 문장은 owner 가 쓴 것만 — `harvest-signal.ts` 의 `ownerLogin` 참조.
            rejectReason: signal.ownerReplyBody,
            outcome,
          });
          break;
        }
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
            ownerReplyBody: signal.ownerReplyBody,
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

    // 지난 회차와 답글이 그대로면 답도 같다. 다시 묻지 않는다.
    const fresh = pendingJudgments.filter((pending) => {
      // 👎 모순 판정은 이 지문 가드를 타지 않는다. 규약(CLAUDE.md §8-1)이 "답변 먼저,
      // 👎 나중" 이라 답글만 있던 회차에 이미 판정(UNCLEAR)돼 지문이 찍혀 있고, 그 뒤
      // 👎 가 달려도 답글은 그대로다 — 여기서 걸러내면 리액션이 영영 확정되지 않는다.
      if (pending.reactionRejected === true) {
        return true;
      }
      const unchanged =
        this.replyJudgmentCheckpoints.get(pending.card.id) ===
        replyFingerprint(pending.replyBody);
      if (unchanged) {
        outcome.skipped += 1;
      }
      return !unchanged;
    });
    if (fresh.length === 0) {
      return;
    }

    let judgments: ReviewReplyJudgment[];
    try {
      judgments = await this.judgeReviewReply.execute({
        items: fresh.map(({ card, replyBody }) => ({
          id: card.id,
          body: card.body,
          replyBody,
        })),
      });
    } catch (error: unknown) {
      if (extractCodexQuota(error)) {
        throw error; // 위와 같은 이유 — 회차를 끊는다.
      }
      outcome.skipped += fresh.length;
      this.logger.warn(
        `PR 리뷰 답글 판정 실패 — 답글 ${fresh.length}건 미결 유지: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // judged 는 "LLM 판정으로 실제 결정된 건수" 다. 판정기는 입력 전건에 대해 결과를
    // 돌려주므로(실패분은 UNCLEAR) judgments.length 를 그대로 더하면 시도 건수가 되고,
    // UNCLEAR 는 아래에서 skipped 로도 세어져 같은 카드가 두 번 집계된다.
    const byId = new Map(judgments.map((judgment) => [judgment.id, judgment]));
    for (const pending of fresh) {
      const judgment = byId.get(pending.card.id);

      if (pending.reactionRejected === true) {
        // 리액션은 👎 인데 판정기가 수용으로 읽었다. 확정하면 그 답글이 규약이 되어
        // 좋은 지적을 억제한다(카드 57) — 사람이 볼 때까지 OPEN 으로 둔다.
        if (judgment?.verdict === 'ACCEPTED') {
          outcome.contradicted += 1;
          // 같은 답글로 다음 회차가 다시 걸리면 재판정 없이 이 결론을 재사용한다.
          this.contradictionCheckpoints.set(pending.card.id, pending.replyBody);
          this.logger.warn(
            `PR 리뷰 기각 보류: 카드 ${pending.card.id} — 👎 리액션과 답글이 어긋난다 (${flattenForLog(judgment.reason)})`,
          );
          continue;
        }
        // 판정기가 기각이라 했거나 판단 불가면 리액션을 따른다(종전 동작).
        await this.markDecisionAndResolve({
          card: pending.card,
          thread: pending.thread,
          status: 'REJECTED',
          rejectReason: pending.ownerReplyBody,
          outcome,
        });
        continue;
      }

      const checkpoint = (): void => {
        this.replyJudgmentCheckpoints.set(
          pending.card.id,
          replyFingerprint(pending.replyBody),
        );
      };
      if (judgment === undefined) {
        // 배열은 뽑혔는데 이 id 가 응답에 없다. 모델의 판단이 아니라 형식 불완전이므로
        // 기록하지 않는다 — 기록하면 답글이 바뀌기 전까지 영구 미결로 굳는다.
        outcome.skipped += 1;
        continue;
      }
      if (judgment.verdict === 'UNCLEAR') {
        outcome.skipped += 1;
        // 모델이 실제로 판단을 유보한 경우다. 같은 답글을 다시 묻지 않는 것이 이
        // checkpoint 의 목적이므로 기록한다. 배열 자체를 못 뽑은 경우는 여기 오지
        // 않는다(위 catch 로 빠져 기록 없이 다음 회차에 재시도된다).
        checkpoint();
        continue;
      }
      outcome.judged += 1;
      if (judgment.verdict === 'REJECTED') {
        // 판정 근거는 원장에 자리가 없다 — 왜 기각으로 읽었는지는 여기서만 남는다.
        // 모델 출력이라 줄바꿈·제어문자가 섞일 수 있어 한 줄로 눌러 찍는다(로그 행 위조 방지).
        this.logger.log(
          `PR 리뷰 답글 판정: 카드 ${pending.card.id} REJECTED — ${flattenForLog(judgment.reason)}`,
        );
      }
      await this.markDecisionAndResolve({
        card: pending.card,
        thread: pending.thread,
        status: judgment.verdict === 'ACCEPTED' ? 'ACKED' : 'REJECTED',
        // 판정기의 한 줄 요약이 아니라 **사람이 쓴 답글 원문**을 남긴다. 이 값은 그대로
        // 다음 리뷰의 레포 규약이 되므로(`renderLearnedConventions`), 요약을 저장하면
        // 학습 재료가 게시 시점에 파괴된다 — 실측(2026-08-26)상 판정 경로로 결론난 기각
        // 4건의 원장 이유가 9~13자였고, 같은 스레드의 실제 답글은 456~774자의 근거
        // 있는 반박이었다(#354·#203·#220·#201). 길이 하한(MIN_REASON_LENGTH)에 걸려
        // 그 4건이 통째로 규약에서 빠져 있었다.
        //
        // 리액션 경로는 이미 답글 원문을 남긴다(`harvest-signal.ts` 의 `replyBody`) —
        // 두 경로가 같은 것을 저장하게 맞춘다.
        rejectReason:
          judgment.verdict === 'REJECTED' ? pending.ownerReplyBody : null,
        outcome,
      });
      // DB 확정이 끝난 뒤에 기록한다. 배치 전체를 미리 찍으면 첫 카드의 쓰기 실패가
      // (`markDecided` 는 try 로 감싸이지 않아 루프를 끊는다) 뒤 카드까지 다음 회차에서
      // 제외시킨다.
      checkpoint();
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
