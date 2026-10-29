import { ADOPTION_MIN_SAMPLE } from './adoption-rate';

// 레포 사본 리뷰의 운영 지표. 기존 채택률 집계(adoption-rate)는 카테고리별이고 학습 레포만 보므로,
// 사본을 켠 레포를 레포 단위로 판정하려고 따로 센다. 입력은 스윕 리뷰 원장 행과 그 카드다.

const OVER_DURATION_MS = 600_000;
const ADOPTED_STATUSES = new Set(['ACKED', 'FIXED']);
const REJECTED_STATUS = 'REJECTED';

export interface RepoReadRunRow {
  repo: string;
  startedAt: Date;
  durationMs: number | null;
  status: string;
  // agent_run.input_snapshot 의 값. 사본을 켜지 않은 레포는 없다.
  repoRead?: string;
  repoReadFallbackReason?: string;
}

export interface RepoReadCardRow {
  repo: string;
  status: string;
  postMode: string;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface AdoptionWindow {
  adopted: number;
  rejected: number;
  // 결론 난 카드가 ADOPTION_MIN_SAMPLE 미만이면 null — 몇 장으로 낸 비율은 판단 근거가 못 된다.
  ratePercent: number | null;
}

export interface RepoReadReport {
  repo: string;
  repoReadCounts: Record<string, number>;
  fallbackReasonCounts: Record<string, number>;
  usedMedianMs: number | null;
  maxDurationMs: number | null;
  over600sCount: number;
  adoption: { current: AdoptionWindow; previous: AdoptionWindow };
  // 카드를 만든 구간 기준. 켜기 전(직전 구간) 대비 ISSUE_COMMENT(학습 신호가 안 쌓이는 묶음) 비율을 본다.
  postModeCounts: {
    current: Record<string, number>;
    previous: Record<string, number>;
  };
}

const countBy = (values: readonly string[]): Record<string, number> =>
  values.reduce<Record<string, number>>(
    (counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }),
    {},
  );

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const adoptionOf = (cards: readonly RepoReadCardRow[]): AdoptionWindow => {
  const adopted = cards.filter((card) =>
    ADOPTED_STATUSES.has(card.status),
  ).length;
  const rejected = cards.filter(
    (card) => card.status === REJECTED_STATUS,
  ).length;
  const total = adopted + rejected;
  return {
    adopted,
    rejected,
    ratePercent:
      total < ADOPTION_MIN_SAMPLE ? null : Math.round((adopted / total) * 100),
  };
};

export const summarizeRepoRead = ({
  runs,
  cards,
  windowStart,
  previousWindowStart,
}: {
  runs: readonly RepoReadRunRow[];
  cards: readonly RepoReadCardRow[];
  // 현재 구간 시작. 직전 구간은 [previousWindowStart, windowStart).
  windowStart: Date;
  previousWindowStart: Date;
}): RepoReadReport[] => {
  const repos = [
    ...new Set([
      ...runs.map((row) => row.repo),
      ...cards.map((row) => row.repo),
    ]),
  ].sort();
  const inCurrent = (at: Date): boolean => at >= windowStart;
  const inPrevious = (at: Date): boolean =>
    at >= previousWindowStart && at < windowStart;

  return repos.map((repo) => {
    const currentRuns = runs.filter(
      (row) => row.repo === repo && inCurrent(row.startedAt),
    );
    const repoCards = cards.filter((card) => card.repo === repo);
    const durations = currentRuns
      .map((row) => row.durationMs)
      .filter((value): value is number => value !== null);
    return {
      repo,
      repoReadCounts: countBy(
        currentRuns
          .map((row) => row.repoRead)
          .filter((value): value is string => value !== undefined),
      ),
      fallbackReasonCounts: countBy(
        currentRuns
          .map((row) => row.repoReadFallbackReason)
          .filter((value): value is string => value !== undefined),
      ),
      usedMedianMs: median(
        currentRuns
          .filter((row) => row.repoRead === 'USED' && row.durationMs !== null)
          .map((row) => row.durationMs as number),
      ),
      maxDurationMs: durations.length === 0 ? null : Math.max(...durations),
      over600sCount: durations.filter((value) => value > OVER_DURATION_MS)
        .length,
      adoption: {
        current: adoptionOf(
          repoCards.filter(
            (card) => card.decidedAt !== null && inCurrent(card.decidedAt),
          ),
        ),
        previous: adoptionOf(
          repoCards.filter(
            (card) => card.decidedAt !== null && inPrevious(card.decidedAt),
          ),
        ),
      },
      postModeCounts: {
        current: countBy(
          repoCards
            .filter((card) => inCurrent(card.createdAt))
            .map((card) => card.postMode),
        ),
        previous: countBy(
          repoCards
            .filter((card) => inPrevious(card.createdAt))
            .map((card) => card.postMode),
        ),
      },
    };
  });
};
