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

// 줄 거리만으로 재현을 판정하면 두 방향으로 틀린다(2026-09-29 실측, 사람 판정과 13회 어긋남 — 놓침 8·잘못 셈 5).
// 5줄 안의 다른 결함 지적을 재현으로 세고, 같은 결함을 원인 줄이 아닌 곳(수십 줄 떨어진 함수 입구 등)에
// 적으면 놓친다. 그래서 가까운 후보도 본문 근거를 요구하고, 먼 후보는 본문이 많이 겹칠 때만 받는다.
// 기준값은 사람이 판정한 후보 쌍 124개로 골랐고, 기준선·미탐 한쪽에서 고른 값을 다른 쪽에 적용해도
// 줄 거리만 볼 때보다 나빠지지 않는 것을 확인했다(오판 13 → 5). 표본이 작아 기준값은 잠정이다.
export const REPLAY_LINE_TOLERANCE = 5;
// 본문 겹침 = 한글 두 글자 조각 중 짧은 쪽 기준 공통 비율. 허용폭 안의 후보는 NEAR 이상이거나 코드
// 식별자가 하나라도 같으면, 같은 파일의 나머지 후보는 거리와 관계없이 FAR 이상이면 같은 결함으로 본다.
// (먼 거리 상한은 60·100·무제한이 실측에서 같은 결과라 두지 않았다.)
export const REPLAY_NEAR_TEXT_OVERLAP = 0.05;
export const REPLAY_FAR_TEXT_OVERLAP = 0.25;
// 위 판정 규칙의 버전. 1 = 줄 거리만(±5), 2 = 줄 거리 + 본문 근거. 규칙을 바꾸면 올린다 —
// 버전이 다른 기준선과의 비교는 채점 차이를 프롬프트 효과로 오인하게 만든다.
export const REPLAY_SCORER_VERSION = 2;

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
    const evidence = compareBodies(labeled.body, candidate.body);
    // 한쪽 본문에 비교할 단서가 없으면 본문으로 판정할 수 없다 — 종전처럼 줄 거리만 본다.
    if (evidence === null) {
      return distance > REPLAY_LINE_TOLERANCE ? null : distance;
    }
    if (distance <= REPLAY_LINE_TOLERANCE) {
      return evidence.overlap >= REPLAY_NEAR_TEXT_OVERLAP ||
        evidence.sharedIdentifiers > 0
        ? distance
        : null;
    }
    return evidence.overlap >= REPLAY_FAR_TEXT_OVERLAP ? distance : null;
  }
  return labeled.category === candidate.category ? Infinity : null;
};

interface BodyEvidence {
  overlap: number;
  sharedIdentifiers: number;
}

// 흔해서 같은 결함의 근거가 되지 못하는 영문 낱말. 언어 키워드와 리뷰 본문에 흔한 낱말(`return`·`error` 등)이
// 남아 있으면, 5줄 안의 다른 결함 지적 둘이 그 낱말 하나만 공유해도 식별자 근거로 재현 판정된다.
// (식별자 모양 — 백틱·camelCase·점 — 으로 좁히는 방법도 실측 결과가 같았지만, `compose` 처럼 평범한
// 이름의 식별자가 정탐 근거인 경우가 있어 목록으로 뺐다.)
const COMMON_WORDS = new Set(
  (
    'the and for pr diff api null true false main test tests ' +
    'return error errors catch try throw const let var await async function ' +
    'string number boolean undefined class import export this value values ' +
    'type types object array new if else while case default void any ' +
    'public private static interface with from not all set get key keys ' +
    'data result response request code file line method'
  ).split(' '),
);

// 백틱 안 코드와 영문 식별자. PR 번호 같은 숫자 조각은 뺀다.
const identifiersOf = (body: string): Set<string> => {
  const found = [
    ...[...body.matchAll(/`([^`]{2,60})`/g)].map((match) => match[1]),
    ...(body.match(/[A-Za-z_][A-Za-z0-9_.]{2,}/g) ?? []),
  ].map((token) => token.toLowerCase());
  return new Set(
    found.filter((token) => !COMMON_WORDS.has(token) && !/^#?\d+$/.test(token)),
  );
};

// 거의 모든 지적 본문에 들어가는 어미·조사 조각. 이것까지 세면 전혀 다른 결함끼리도 겹침이
// 10% 를 넘는다(실측 본문 148개 중 143개에 `니다`).
const COMMON_BIGRAMS = new Set([
  '니다',
  '습니',
  '합니',
  '지않',
  '수있',
  '으로',
  '있습',
  '에서',
  '하지',
  '므로',
  '되지',
  '할수',
  '됩니',
  '하는',
  '지만',
  '않습',
  '본문',
]);

// 한글만 남겨 이웃한 두 글자 조각으로 쪼갠다. 띄어쓰기·조사 차이에 덜 흔들리게 하려는 것이다.
const hangulBigramsOf = (body: string): Set<string> => {
  const hangul = body.replace(/[^가-힣]/g, '');
  const bigrams = new Set<string>();
  for (let index = 0; index + 1 < hangul.length; index += 1) {
    const bigram = hangul.slice(index, index + 2);
    if (!COMMON_BIGRAMS.has(bigram)) {
      bigrams.add(bigram);
    }
  }
  return bigrams;
};

const countShared = (left: Set<string>, right: Set<string>): number =>
  [...left].filter((token) => right.has(token)).length;

// 두 본문 중 어느 쪽이든 한글 조각도 식별자도 없으면 null — 비교할 단서가 없다.
export const compareBodies = (
  left: string,
  right: string,
): BodyEvidence | null => {
  const leftBigrams = hangulBigramsOf(left);
  const rightBigrams = hangulBigramsOf(right);
  const leftIdentifiers = identifiersOf(left);
  const rightIdentifiers = identifiersOf(right);
  if (
    (leftBigrams.size === 0 && leftIdentifiers.size === 0) ||
    (rightBigrams.size === 0 && rightIdentifiers.size === 0)
  ) {
    return null;
  }
  const shorter = Math.min(leftBigrams.size, rightBigrams.size);
  return {
    overlap:
      shorter === 0 ? 0 : countShared(leftBigrams, rightBigrams) / shorter,
    sharedIdentifiers: countShared(leftIdentifiers, rightIdentifiers),
  };
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
// 좋고 나쁨은 라벨마다 반대다(REJECTED 재현=오탐 재발은 낮을수록, FIXED·MISSED 재현은 높을수록 좋다).
// 라벨을 넘기면 범위 밖일 때 어느 쪽으로 벗어났는지 붙인다. 통과 여부는 재실행까지 봐야 하므로 여기서 내지 않는다.

export type BaselineVerdict = '변동 범위 안' | '변동 범위 밖' | '판단 불가';

export type BaselineDirection = '좋은 쪽' | '나쁜 쪽';

export interface BaselineComparison {
  baselineMean: number | null;
  currentMean: number | null;
  delta: number | null;
  verdict: BaselineVerdict;
  reason: string;
  // 변동 범위 밖이고 라벨을 알 때만 있다.
  direction?: BaselineDirection;
}

const LOWER_IS_BETTER: Record<ReplayLabel, boolean> = {
  REJECTED: true,
  FIXED: false,
  MISSED: false,
};

const measuredTrials = (summary: TrialSummary): number =>
  summary.rates.filter((rate) => rate !== null).length;

export const compareWithBaseline = (
  current: TrialSummary,
  baseline: TrialSummary,
  label?: ReplayLabel,
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
  if (overlaps) {
    return {
      ...base,
      verdict: '변동 범위 안',
      reason: '두 실행의 회차별 범위가 겹친다',
    };
  }
  const outOfRange: BaselineComparison = {
    ...base,
    verdict: '변동 범위 밖',
    reason: '두 실행의 회차별 범위가 겹치지 않는다',
  };
  if (label === undefined) {
    return outOfRange;
  }
  // 범위가 겹치지 않으면 평균 차이의 부호가 벗어난 쪽이다.
  const wentLower = delta < 0;
  return {
    ...outOfRange,
    direction: wentLower === LOWER_IS_BETTER[label] ? '좋은 쪽' : '나쁜 쪽',
  };
};

// 미탐은 diff 안 잘린 그룹으로 판정한다 — 잘린 그룹은 지적 줄이 입력에서 빠져 늘 0% 라 움직이지 않고,
// 합친 값에 섞이면 모델 쪽 변화가 묽어진다(2026-09-29 미탐: 안 잘림 59% · 잘림 0%).
// 기준선에 분리 집계가 없으면(미탐 없이 잰 기준선·분리 집계 전 보고서) 합친 값으로 대신하지 않고 판단 불가로 둔다.
// 전체 카드가 같아도 잘림 판정이 바뀌면 안 잘린 카드 부분집합이 달라지므로, 그 집합이 같을 때만 비교한다.
const unjudgeableMissedIntact = (
  current: TrialSummary,
  reason: string,
): BaselineComparison => ({
  baselineMean: null,
  currentMean: current.meanRate,
  delta: null,
  verdict: '판단 불가',
  reason,
});

export const compareMissedIntactWithBaseline = (
  current: TrialSummary,
  baseline: TrialSummary | undefined,
  sameIntactSample: boolean,
): BaselineComparison => {
  if (baseline === undefined) {
    return unjudgeableMissedIntact(
      current,
      '기준선 보고서에 미탐 diff 잘림 분리 집계(trials.byDiffTruncation.missed)가 없다 — 미탐을 포함해 분리 집계가 있는 보고서로 기준선을 다시 잴 것',
    );
  }
  if (!sameIntactSample) {
    return unjudgeableMissedIntact(
      current,
      '기준선과 diff 안 잘린 미탐 카드가 다르다 — 잘림 판정이 바뀌었으면 기준선을 다시 잴 것',
    );
  }
  return compareWithBaseline(current, baseline, 'MISSED');
};

// 보고서에서 diff 안 잘린 그룹의 미탐 id. 합친 표본(sampleIdsOf)이 같아도 이 집합은 다를 수 있다.
export const intactMissedIdsOf = (report: unknown): number[] => {
  if (typeof report !== 'object' || report === null) {
    return [];
  }
  const { groups } = report as {
    groups?: {
      diffTruncated?: unknown;
      results?: { id?: unknown; label?: unknown }[];
    }[];
  };
  const ids = new Set<number>();
  for (const group of groups ?? []) {
    if (group.diffTruncated !== false) {
      continue;
    }
    for (const result of group.results ?? []) {
      if (result.label === 'MISSED' && typeof result.id === 'number') {
        ids.add(result.id);
      }
    }
  }
  return Array.from(ids).sort((left, right) => left - right);
};

// 기준선 보고서에서 라벨별 요약을 꺼낸다. 반복 측정 전의 보고서(`score` 만 있는 것)는 1회차로 읽는다 —
// 그래야 지금까지 쌓인 보고서와도 비교가 끊기지 않는다. 형태를 알 수 없으면 null.
// 미탐(missed)은 선택 항목이다 — 미탐 없이 돈 보고서와 그 전 보고서에는 없다.
export interface BaselineSummaries {
  rejected: TrialSummary;
  fixed: TrialSummary;
  missed?: TrialSummary;
  // 미탐의 diff 안 잘린 그룹. 분리 집계 전 보고서에는 없다.
  missedIntact?: TrialSummary;
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
      byDiffTruncation?: { missed?: { intact?: unknown } };
    };
    score?: { rejected?: ReplayRate; fixed?: ReplayRate };
  };
  if (isTrialSummary(trials?.rejected) && isTrialSummary(trials?.fixed)) {
    if (trials.missed !== undefined && !isTrialSummary(trials.missed)) {
      return null;
    }
    const missedIntact = trials.byDiffTruncation?.missed?.intact;
    if (missedIntact !== undefined && !isTrialSummary(missedIntact)) {
      return null;
    }
    return {
      rejected: trials.rejected,
      fixed: trials.fixed,
      ...(trials.missed === undefined ? {} : { missed: trials.missed }),
      ...(missedIntact === undefined ? {} : { missedIntact }),
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

// 원장(agent_run.output)에 남은 리뷰 결과에서 재생 지적을 꺼낸다 — 재채점은 모델을 다시 부르지 않고 이것을 쓴다.
// 형식이 하나라도 틀리면 null. 틀린 지적만 버리면 재현율이 원래 실행과 다른 입력으로 계산된다.
export const replayedFindingsOf = (
  output: unknown,
): ReplayedFinding[] | null => {
  if (typeof output !== 'object' || output === null) {
    return null;
  }
  const { findings } = output as { findings?: unknown };
  if (!Array.isArray(findings)) {
    return null;
  }
  const parsed: ReplayedFinding[] = [];
  for (const item of findings as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      return null;
    }
    const { file, line, category, body } = item as Record<string, unknown>;
    if (
      typeof category !== 'string' ||
      typeof body !== 'string' ||
      (file !== undefined && typeof file !== 'string') ||
      (line !== undefined && typeof line !== 'number')
    ) {
      return null;
    }
    parsed.push({
      category,
      body,
      ...(file === undefined ? {} : { file }),
      ...(line === undefined ? {} : { line }),
    });
  }
  return parsed;
};

// 스킵이 하나라도 있으면 회차마다 측정한 카드가 달랐을 수 있다.
export const skippedCountOf = (report: unknown): number => {
  if (typeof report !== 'object' || report === null) {
    return 0;
  }
  const { skipped } = report as { skipped?: unknown[] };
  return Array.isArray(skipped) ? skipped.length : 0;
};

// 버전 칸이 없는 보고서는 칸이 생기기 전(줄 거리만 보던 규칙 1)에 만든 것이다.
export const scorerVersionOf = (report: unknown): number => {
  if (typeof report !== 'object' || report === null) {
    return 1;
  }
  const { scorerVersion } = report as { scorerVersion?: unknown };
  return typeof scorerVersion === 'number' ? scorerVersion : 1;
};

export const isSameSample = (
  left: readonly number[],
  right: readonly number[],
): boolean =>
  left.length === right.length &&
  left.every((id, index) => id === right[index]);
