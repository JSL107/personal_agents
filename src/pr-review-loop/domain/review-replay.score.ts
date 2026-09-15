export type ReplayLabel = 'REJECTED' | 'FIXED';

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
  results: FindingReplayResult[];
}

export const REPLAY_LINE_TOLERANCE = 5;

export const scoreReplay = (pairs: readonly ReplayPair[]): ReplayScore => {
  const matched = assignMatches(pairs);
  const rejected: ReplayRate = { total: 0, reproduced: 0, rate: null };
  const fixed: ReplayRate = { total: 0, reproduced: 0, rate: null };
  const results = pairs.map((pair, index): FindingReplayResult => {
    const claimedCandidate = matched[index];
    const rate = pair.labeled.label === 'REJECTED' ? rejected : fixed;
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
  for (const rate of [rejected, fixed]) {
    if (rate.total > 0) {
      rate.rate = rate.reproduced / rate.total;
    }
  }
  return { rejected, fixed, results };
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
    normalizePath(labeled.filePath) !== normalizePath(candidate.file)
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
