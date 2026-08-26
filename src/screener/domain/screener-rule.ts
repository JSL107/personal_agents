import { StockIndicators } from '../../market-data/domain/stock-indicator';

export const MINIMUM_TURNOVER60 = 500_000_000;
// 당일 상승률 상한. 스크리너는 급등한 그날의 종가를 보고 다음 거래일 시가에 사므로,
// 상한이 없으면 하루에 크게 오른 종목이 순위 상단을 차지한다(SWING 은 거래량 급증·1개월
// 수익률·신고가 위치를 합산하는데, 급등 당일에는 셋이 동시에 뛴다).
//
// 기본값이 상한 없음인 것은 근거가 있어서가 아니라 아직 없어서다 — 값은 백테스트로
// 재서 정한다. 그때까지 운영 동작은 지금과 같아야 하므로 무한대를 기본으로 둔다.
export const DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT = Number.POSITIVE_INFINITY;
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

// 상한을 넘긴 종목만 뺀다. `return1d` 가 null 인 종목(첫 봉이라 전일이 없음)은 급등했다는
// 근거가 없으므로 통과시킨다 — 지표 결측을 급등으로 취급하면 신규 상장이 통째로 빠진다.
const withinDailyGainCap = (
  candidate: ScreenCandidate,
  maximumDailyGainPercent: number,
): boolean => {
  const { return1d } = candidate.indicators;
  if (return1d === null) {
    return true;
  }
  return return1d <= maximumDailyGainPercent;
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
  // 백테스트가 하한을 바꿔가며 성적을 비교할 수 있도록 주입 가능하게 열어 둔다.
  // 기본값이 운영 규칙이므로 기존 호출부는 그대로 둔다.
  minimumTurnover60: number = MINIMUM_TURNOVER60,
  maximumDailyGainPercent: number = DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT,
): ScreenedStock[] => {
  const passed = candidates.filter(
    (candidate) =>
      candidate.indicators.turnover60 !== null &&
      candidate.indicators.turnover60 >= minimumTurnover60 &&
      withinDailyGainCap(candidate, maximumDailyGainPercent) &&
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
