import { StockIndicators } from '../../market-data/domain/stock-indicator';

export const MINIMUM_TURNOVER60 = 500_000_000;
export const SCREENER_RULE_VERSION = 2;
export type ScreenStrategy = 'LONG_TERM' | 'SWING';

export interface ScreenCandidate {
  tickerId: number;
  code: string;
  name: string;
  krxMarket: string | null;
  indicators: StockIndicators;
}

export interface ScreenedStock {
  tickerId: number;
  code: string;
  name: string;
  krxMarket: string | null;
  score: number;
  indicators: StockIndicators;
}

type RankingValueSelector = (candidate: ScreenCandidate) => number | null;

interface RankingMaterial {
  select: RankingValueSelector;
  descending: boolean;
}

const passesLongTerm = (candidate: ScreenCandidate): boolean => {
  const { close, ma120, isAligned } = candidate.indicators;
  return ma120 !== null && isAligned === true && close > ma120;
};

const passesSwing = (candidate: ScreenCandidate): boolean => {
  const { close, ma20, volumeSurge } = candidate.indicators;
  return (
    ma20 !== null && close > ma20 && volumeSurge !== null && volumeSurge >= 1.5
  );
};

const materialsByStrategy: Record<ScreenStrategy, RankingMaterial[]> = {
  LONG_TERM: [
    { select: (candidate) => candidate.indicators.return6m, descending: true },
    {
      select: (candidate) => candidate.indicators.volatility20,
      descending: false,
    },
    {
      select: (candidate) => candidate.indicators.high200Position,
      descending: true,
    },
  ],
  SWING: [
    {
      select: (candidate) => candidate.indicators.volumeSurge,
      descending: true,
    },
    { select: (candidate) => candidate.indicators.return1m, descending: true },
    {
      select: (candidate) => candidate.indicators.high200Position,
      descending: true,
    },
  ],
};

const rankCandidates = (
  candidates: ScreenCandidate[],
  material: RankingMaterial,
): Map<string, number> => {
  const sorted = [...candidates].sort((left, right) => {
    const leftValue = material.select(left);
    const rightValue = material.select(right);
    if (leftValue === null && rightValue !== null) {
      return 1;
    }
    if (leftValue !== null && rightValue === null) {
      return -1;
    }
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return material.descending
        ? rightValue - leftValue
        : leftValue - rightValue;
    }
    return left.code.localeCompare(right.code);
  });
  return new Map(sorted.map((candidate, index) => [candidate.code, index + 1]));
};

export const screenStocks = (
  candidates: ScreenCandidate[],
  strategy: ScreenStrategy,
  limit: number,
): ScreenedStock[] => {
  const passed = candidates.filter(
    (candidate) =>
      candidate.indicators.turnover60 !== null &&
      candidate.indicators.turnover60 >= MINIMUM_TURNOVER60 &&
      (strategy === 'LONG_TERM'
        ? passesLongTerm(candidate)
        : passesSwing(candidate)),
  );
  if (passed.length === 0) {
    return [];
  }

  const rankingMaps = materialsByStrategy[strategy].map((material) =>
    rankCandidates(passed, material),
  );
  const candidateCount = passed.length;
  const stocks = passed.map((candidate) => {
    const rankSum = rankingMaps.reduce(
      (sum, ranks) => sum + (ranks.get(candidate.code) as number),
      0,
    );
    const rawScore =
      candidateCount === 1
        ? 100
        : ((3 * candidateCount - rankSum) / (3 * candidateCount - 3)) * 100;
    return {
      ...candidate,
      score: Math.round(rawScore * 100) / 100,
    };
  });

  return stocks
    .sort(
      (left, right) =>
        right.score - left.score || left.code.localeCompare(right.code),
    )
    .slice(0, Math.max(0, limit));
};
