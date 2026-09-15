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
  const results = pairs.map(({ labeled, replayed }): FindingReplayResult => {
    const matched = matchReplayedFinding(labeled, replayed);
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

export const matchReplayedFinding = (
  labeled: LabeledFinding,
  replayed: readonly ReplayedFinding[],
): ReplayedFinding | undefined => {
  let matched: ReplayedFinding | undefined;
  let closestDistance = Infinity;
  for (const candidate of replayed) {
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
