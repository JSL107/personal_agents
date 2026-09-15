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
  const rejected: ReplayRate = { total: 0, reproduced: 0, rate: null };
  const fixed: ReplayRate = { total: 0, reproduced: 0, rate: null };
  const claimed = new Set<ReplayedFinding>();
  const results = pairs.map(({ labeled, replayed }): FindingReplayResult => {
    const matched = matchReplayedFinding(labeled, replayed, claimed);
    if (matched !== undefined) {
      claimed.add(matched);
    }
    const rate = labeled.label === 'REJECTED' ? rejected : fixed;
    rate.total += 1;
    if (matched !== undefined) {
      rate.reproduced += 1;
    }
    return {
      id: labeled.id,
      label: labeled.label,
      reproduced: matched !== undefined,
      ...(matched === undefined ? {} : { matched }),
    };
  });
  for (const rate of [rejected, fixed]) {
    if (rate.total > 0) {
      rate.rate = rate.reproduced / rate.total;
    }
  }
  return { rejected, fixed, results };
};

// 이미 다른 카드에 매칭된 후보는 제외한다 — 한 재생 지적이 가까운 카드 여러 장을 동시에 채우면
// 재현 수가 부풀려진다. 표본 순서대로 가져가는 greedy 라 같은 표본이면 결과가 재현된다.
export const matchReplayedFinding = (
  labeled: LabeledFinding,
  replayed: readonly ReplayedFinding[],
  alreadyMatched: ReadonlySet<ReplayedFinding> = new Set(),
): ReplayedFinding | undefined => {
  let matched: ReplayedFinding | undefined;
  let closestDistance = Infinity;
  for (const candidate of replayed) {
    if (alreadyMatched.has(candidate)) {
      continue;
    }
    let distance = Infinity;
    if (labeled.filePath === null) {
      if (labeled.category !== candidate.category) {
        continue;
      }
    } else {
      if (
        candidate.file === undefined ||
        normalizePath(labeled.filePath) !== normalizePath(candidate.file)
      ) {
        continue;
      }
      if (labeled.line !== null && candidate.line !== undefined) {
        distance = Math.abs(labeled.line - candidate.line);
        if (distance > REPLAY_LINE_TOLERANCE) {
          continue;
        }
      } else if (labeled.category !== candidate.category) {
        continue;
      }
    }
    if (matched === undefined || distance < closestDistance) {
      matched = candidate;
      closestDistance = distance;
    }
  }
  return matched;
};

const normalizePath = (path: string): string => {
  return path.trim().replace(/^(?:(?:\.\/)+)?(?:[ab]\/)?/, '');
};
