// MISSED 는 카드가 아니라 외부 리뷰(예: gemini)가 잡고 이대리는 놓친 결함이다. 재현되면 좋은 쪽이다.
export type ReplayLabel = 'REJECTED' | 'FIXED' | 'MISSED';

export interface LabeledFinding {
  id: number;
  label: ReplayLabel;
  filePath: string | null;
  line: number | null;
  category: string;
  body: string;
}

export interface ReplayedFinding {
  file?: string;
  line?: number;
  category: string;
  body: string;
}

export interface ReplayPair {
  labeled: LabeledFinding;
  replayed: readonly ReplayedFinding[];
}

export interface FindingReplayResult {
  id: number;
  label: ReplayLabel;
  reproduced: boolean;
  matched?: ReplayedFinding;
}

export interface ReplayRate {
  total: number;
  reproduced: number;
  rate: number | null;
}

export interface ReplayScore {
  rejected: ReplayRate;
  fixed: ReplayRate;
  missed: ReplayRate;
  results: FindingReplayResult[];
}

export const REPLAY_LINE_TOLERANCE = 5;

export const scoreReplay = (pairs: readonly ReplayPair[]): ReplayScore => {
  const matched = assignMatches(pairs);
  const rejected: ReplayRate = { total: 0, reproduced: 0, rate: null };
  const fixed: ReplayRate = { total: 0, reproduced: 0, rate: null };
  const missed: ReplayRate = { total: 0, reproduced: 0, rate: null };
  const rateOf: Record<ReplayLabel, ReplayRate> = {
    REJECTED: rejected,
    FIXED: fixed,
    MISSED: missed,
  };
  const results = pairs.map((pair, index): FindingReplayResult => {
    const claimedCandidate = matched[index];
    const rate = rateOf[pair.labeled.label];
    rate.total += 1;
    if (claimedCandidate !== undefined) {
      rate.reproduced += 1;
    }
    return {
      id: pair.labeled.id,
      label: pair.labeled.label,
      reproduced: claimedCandidate !== undefined,
      ...(claimedCandidate === undefined ? {} : { matched: claimedCandidate }),
    };
  });
  for (const rate of [rejected, fixed, missed]) {
    if (rate.total > 0) {
      rate.rate = rate.reproduced / rate.total;
    }
  }
  return { rejected, fixed, missed, results };
};

// 카드와 재생 지적을 일대일로, 그러면서 **최대 개수**로 잇는다(Kuhn 증대경로).
// 앞 카드부터 가장 가까운 후보를 집어가는 greedy 는 카드 순서 때문에 잡을 수 있는 재현을 놓친다 —
// 카드가 20·15행이고 후보가 18·25행이면 greedy 는 1/2, 최대 매칭은 2/2 다(20↔25, 15↔18).
// 후보는 거리가 가까운 순으로 시도하므로, 개수가 같은 배정 중에서는 종전처럼 가까운 짝이 남는다.
const assignMatches = (
  pairs: readonly ReplayPair[],
): (ReplayedFinding | undefined)[] => {
  const holderOf = new Map<ReplayedFinding, number>();
  const matched: (ReplayedFinding | undefined)[] = pairs.map(() => undefined);
  pairs.forEach((_, index) => {
    tryAssign(pairs, index, new Set<ReplayedFinding>(), holderOf, matched);
  });
  return matched;
};

const tryAssign = (
  pairs: readonly ReplayPair[],
  index: number,
  visited: Set<ReplayedFinding>,
  holderOf: Map<ReplayedFinding, number>,
  matched: (ReplayedFinding | undefined)[],
): boolean => {
  const { labeled, replayed } = pairs[index];
  for (const candidate of candidatesByDistance(labeled, replayed)) {
    if (visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);
    const holder = holderOf.get(candidate);
    if (
      holder === undefined ||
      tryAssign(pairs, holder, visited, holderOf, matched)
    ) {
      holderOf.set(candidate, index);
      matched[index] = candidate;
      return true;
    }
  }
  return false;
};

// 이 카드가 받을 수 있는 후보를 가까운 순으로 낸다. 줄 거리를 잴 수 없는 후보(줄 없음·파일 없음)는
// 잰 것들 뒤에 원래 순서로 붙는다.
export const candidatesByDistance = (
  labeled: LabeledFinding,
  replayed: readonly ReplayedFinding[],
): ReplayedFinding[] => {
  const scored: { candidate: ReplayedFinding; distance: number }[] = [];
  for (const candidate of replayed) {
    const distance = matchDistance(labeled, candidate);
    if (distance !== null) {
      scored.push({ candidate, distance });
    }
  }
  return scored
    .sort((left, right) => left.distance - right.distance)
    .map((entry) => entry.candidate);
};

// 매칭되면 줄 거리(잴 수 없으면 Infinity), 매칭되지 않으면 null.
const matchDistance = (
  labeled: LabeledFinding,
  candidate: ReplayedFinding,
): number | null => {
  if (labeled.filePath === null) {
    return labeled.category === candidate.category ? Infinity : null;
  }
  if (
    candidate.file === undefined ||
    !isSameFile(labeled.filePath, candidate.file)
  ) {
    return null;
  }
  if (labeled.line !== null && candidate.line !== undefined) {
    const distance = Math.abs(labeled.line - candidate.line);
    return distance > REPLAY_LINE_TOLERANCE ? null : distance;
  }
  return labeled.category === candidate.category ? Infinity : null;
};

// 단건 조회용 — 이미 다른 카드가 가져간 후보는 제외한다.
export const matchReplayedFinding = (
  labeled: LabeledFinding,
  replayed: readonly ReplayedFinding[],
  alreadyMatched: ReadonlySet<ReplayedFinding> = new Set(),
): ReplayedFinding | undefined =>
  candidatesByDistance(labeled, replayed).find(
    (candidate) => !alreadyMatched.has(candidate),
  );

const normalizePath = (path: string): string => {
  return path.trim().replace(/^(?:(?:\.\/)+)?(?:[ab]\/)?/, '');
};

// 경로가 같으면 같은 파일. 한쪽이 파일 이름만 있으면(외부 리뷰 요약표처럼) 다른 쪽의 마지막
// 경로 조각과 비교한다 — 전체 경로를 모르는 표본도 매칭되게. 둘 다 경로가 있으면 종전처럼 전체를 비교한다.
const isSameFile = (left: string, right: string): boolean => {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  if (normalizedLeft.includes('/') && normalizedRight.includes('/')) {
    return false;
  }
  return normalizedLeft.split('/').pop() === normalizedRight.split('/').pop();
};

// ── 반복 측정 ──────────────────────────────────────────────────────────────
// 같은 표본을 여러 번 재생한 결과를 묶는다. 모델 출력은 회차마다 달라서, 한 번의 비교로는
// 프롬프트 개선과 회차 변동을 가를 수 없다(다른 과제에서 같은 프롬프트 4회가 6.9~38% 로 흔들렸다).

export interface TrialSummary {
  trials: number;
  // 이 라벨의 카드 수(회차 사이에 스킵된 카드도 한 번 보였으면 센다)
  total: number;
  // 회차별 재현율 — 그 회차에 스킵 없이 재생된 카드 기준. 카드가 없던 회차는 null
  rates: (number | null)[];
  meanRate: number | null;
  minRate: number | null;
  maxRate: number | null;
  // 한 번이라도 재현된 카드 수(pass@k)
  anyTrial: number;
  // 모든 회차에서 재현된 카드 수(pass^k). 어느 회차에서 스킵된 카드는 들지 않는다
  everyTrial: number;
}

export const summarizeTrials = (
  trialResults: readonly (readonly FindingReplayResult[])[],
  label: ReplayLabel,
): TrialSummary => {
  const reproducedCount = new Map<number, number>();
  const seenCount = new Map<number, number>();
  const rates = trialResults.map((results) => {
    const ofLabel = results.filter((result) => result.label === label);
    for (const result of ofLabel) {
      seenCount.set(result.id, (seenCount.get(result.id) ?? 0) + 1);
      if (result.reproduced) {
        reproducedCount.set(
          result.id,
          (reproducedCount.get(result.id) ?? 0) + 1,
        );
      }
    }
    if (ofLabel.length === 0) {
      return null;
    }
    return (
      ofLabel.filter((result) => result.reproduced).length / ofLabel.length
    );
  });
  const measured = rates.filter((rate): rate is number => rate !== null);
  const trials = trialResults.length;
  return {
    trials,
    total: seenCount.size,
    rates,
    meanRate:
      measured.length === 0
        ? null
        : measured.reduce((sum, rate) => sum + rate, 0) / measured.length,
    minRate: measured.length === 0 ? null : Math.min(...measured),
    maxRate: measured.length === 0 ? null : Math.max(...measured),
    anyTrial: Array.from(reproducedCount.values()).filter((count) => count > 0)
      .length,
    everyTrial: Array.from(reproducedCount.entries()).filter(
      ([id, count]) => count === trials && seenCount.get(id) === trials,
    ).length,
  };
};

// ── diff 잘림 분리 ─────────────────────────────────────────────────────────
// diff 가 잘린 그룹은 잘린 지점 뒤 파일이 모델 입력에서 빠진다. 그 그룹의 미재현은 모델이 놓친 것과
// 입력에 없던 것이 섞이므로, 한 점수로 합치면 두 효과를 가를 수 없다(2026-09-29 미탐: 전체 31% =
// 안 잘린 13건 59% + 잘린 12건 0%). 합친 값은 그대로 두고 나눈 값을 따로 낸다.

export interface TrialGroupResults {
  trial: number;
  diffTruncated: boolean;
  results: readonly FindingReplayResult[];
}

export interface TruncationSplit {
  truncated: TrialSummary;
  intact: TrialSummary;
}

export const summarizeTrialsByTruncation = (
  groups: readonly TrialGroupResults[],
  trials: number,
  label: ReplayLabel,
): TruncationSplit => {
  const resultsOf = (truncated: boolean): FindingReplayResult[][] => {
    const byTrial: FindingReplayResult[][] = Array.from(
      { length: trials },
      () => [],
    );
    for (const group of groups) {
      if (group.diffTruncated === truncated) {
        byTrial[group.trial - 1].push(...group.results);
      }
    }
    return byTrial;
  };
  return {
    truncated: summarizeTrials(resultsOf(true), label),
    intact: summarizeTrials(resultsOf(false), label),
  };
};

// ── 기준선 비교 ────────────────────────────────────────────────────────────
// 두 실행의 회차별 재현율 범위(최소~최대)가 겹치면 차이를 회차 변동과 구분할 수 없다고 본다.
// 어느 쪽이든 1회뿐이면 변동 폭을 모르므로 판정하지 않는다 — 점 하나끼리의 차이는 무엇이든 될 수 있다.
// 좋고 나쁨은 라벨마다 반대다(REJECTED 재현=오탐 재발은 낮을수록, FIXED 재현=정탐 유지는 높을수록 좋다)
// 그래서 방향은 판정하지 않고 차이와 범위만 낸다.

export type BaselineVerdict = '변동 범위 안' | '변동 범위 밖' | '판단 불가';

export interface BaselineComparison {
  baselineMean: number | null;
  currentMean: number | null;
  delta: number | null;
  verdict: BaselineVerdict;
  reason: string;
}

const measuredTrials = (summary: TrialSummary): number =>
  summary.rates.filter((rate) => rate !== null).length;

export const compareWithBaseline = (
  current: TrialSummary,
  baseline: TrialSummary,
): BaselineComparison => {
  const delta =
    current.meanRate === null || baseline.meanRate === null
      ? null
      : current.meanRate - baseline.meanRate;
  const base = {
    baselineMean: baseline.meanRate,
    currentMean: current.meanRate,
    delta,
  };
  if (delta === null) {
    return { ...base, verdict: '판단 불가', reason: '한쪽에 재현율이 없다' };
  }
  // 요청한 회차(trials)가 아니라 실제로 값이 나온 회차를 센다. 한 회차가 통째로 스킵되면
  // 관측 하나로 범위를 삼게 되어, 근거 없이 "범위 안/밖" 을 확정한다.
  if (measuredTrials(current) < 2 || measuredTrials(baseline) < 2) {
    return {
      ...base,
      verdict: '판단 불가',
      reason:
        '실제로 측정된 회차가 2번 미만인 쪽이 있어 변동 폭을 모른다 — 양쪽 모두 스킵 없이 --trials 2 이상으로 돌릴 것',
    };
  }
  // meanRate 가 있으면 min/max 도 있다.
  const overlaps =
    (current.minRate as number) <= (baseline.maxRate as number) &&
    (baseline.minRate as number) <= (current.maxRate as number);
  return overlaps
    ? {
        ...base,
        verdict: '변동 범위 안',
        reason: '두 실행의 회차별 범위가 겹친다',
      }
    : {
        ...base,
        verdict: '변동 범위 밖',
        reason: '두 실행의 회차별 범위가 겹치지 않는다',
      };
};

// 기준선 보고서에서 라벨별 요약을 꺼낸다. 반복 측정 전의 보고서(`score` 만 있는 것)는 1회차로 읽는다 —
// 그래야 지금까지 쌓인 보고서와도 비교가 끊기지 않는다. 형태를 알 수 없으면 null.
// 미탐(missed)은 선택 항목이다 — 미탐 없이 돈 보고서와 그 전 보고서에는 없다.
export interface BaselineSummaries {
  rejected: TrialSummary;
  fixed: TrialSummary;
  missed?: TrialSummary;
}

export const readBaselineSummaries = (
  report: unknown,
): BaselineSummaries | null => {
  if (typeof report !== 'object' || report === null) {
    return null;
  }
  const { trials, score } = report as {
    trials?: {
      rejected?: TrialSummary;
      fixed?: TrialSummary;
      missed?: unknown;
    };
    score?: { rejected?: ReplayRate; fixed?: ReplayRate };
  };
  if (isTrialSummary(trials?.rejected) && isTrialSummary(trials?.fixed)) {
    if (trials.missed !== undefined && !isTrialSummary(trials.missed)) {
      return null;
    }
    return {
      rejected: trials.rejected,
      fixed: trials.fixed,
      ...(trials.missed === undefined ? {} : { missed: trials.missed }),
    };
  }
  if (isReplayRate(score?.rejected) && isReplayRate(score?.fixed)) {
    return {
      rejected: fromSingleRate(score.rejected),
      fixed: fromSingleRate(score.fixed),
    };
  }
  return null;
};

// 필드 하나라도 빠지거나 타입이 틀리면 거부한다 — 받아들이면 비교에 NaN·undefined 가 섞여
// "형식이 틀리면 모델을 부르기 전에 실패한다" 는 약속이 깨진다.
const isRateValue = (value: unknown): boolean =>
  value === null || typeof value === 'number';

const isTrialSummary = (value: unknown): value is TrialSummary => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const summary = value as Record<keyof TrialSummary, unknown>;
  return (
    typeof summary.trials === 'number' &&
    typeof summary.total === 'number' &&
    Array.isArray(summary.rates) &&
    summary.rates.every(isRateValue) &&
    isRateValue(summary.meanRate) &&
    isRateValue(summary.minRate) &&
    isRateValue(summary.maxRate) &&
    typeof summary.anyTrial === 'number' &&
    typeof summary.everyTrial === 'number'
  );
};

const isReplayRate = (value: unknown): value is ReplayRate => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rate = value as Record<keyof ReplayRate, unknown>;
  return (
    typeof rate.total === 'number' &&
    typeof rate.reproduced === 'number' &&
    isRateValue(rate.rate)
  );
};

const fromSingleRate = (rate: ReplayRate): TrialSummary => ({
  trials: 1,
  total: rate.total,
  rates: [rate.rate],
  meanRate: rate.rate,
  minRate: rate.rate,
  maxRate: rate.rate,
  anyTrial: rate.reproduced,
  everyTrial: rate.reproduced,
});

// 보고서에서 실제로 측정된 카드 id. 스킵된 카드는 넣지 않는다 — 선택한 표본이 같아도 서로 다른
// 그룹이 실패하면 재현율은 다른 카드 부분집합으로 계산되기 때문이다. 스킵 여부는 따로 센다.
// `--ids` 없이 돌리면 표본은 "최근 카드 N건" 이라 새 카드가 쌓이면 바뀐다. 비교를 막지는 않되 알린다.
export const sampleIdsOf = (report: unknown): number[] => {
  if (typeof report !== 'object' || report === null) {
    return [];
  }
  const { groups } = report as {
    groups?: { results?: { id?: unknown }[] }[];
  };
  const ids = new Set<number>();
  for (const group of groups ?? []) {
    for (const result of group.results ?? []) {
      if (typeof result.id === 'number') {
        ids.add(result.id);
      }
    }
  }
  return Array.from(ids).sort((left, right) => left - right);
};

// 스킵이 하나라도 있으면 회차마다 측정한 카드가 달랐을 수 있다.
export const skippedCountOf = (report: unknown): number => {
  if (typeof report !== 'object' || report === null) {
    return 0;
  }
  const { skipped } = report as { skipped?: unknown[] };
  return Array.isArray(skipped) ? skipped.length : 0;
};

export const isSameSample = (
  left: readonly number[],
  right: readonly number[],
): boolean =>
  left.length === right.length &&
  left.every((id, index) => id === right[index]);
