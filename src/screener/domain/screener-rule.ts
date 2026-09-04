import { StockIndicators } from '../../market-data/domain/stock-indicator';

export const MINIMUM_TURNOVER60 = 500_000_000;
// 당일 상승률 상한. 스크리너는 급등한 그날의 종가를 보고 다음 거래일 시가에 사므로,
// 상한이 없으면 하루에 크게 오른 종목이 순위 상단을 차지한다(SWING 은 거래량 급증·1개월
// 수익률·신고가 위치를 합산하는데, 급등 당일에는 셋이 동시에 뛴다).
//
// 기본값이 상한 없음인 것은 근거가 있어서가 아니라 아직 없어서다 — 값은 백테스트로
// 재서 정한다. 그때까지 운영 동작은 지금과 같아야 하므로 무한대를 기본으로 둔다.
export const DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT = Number.POSITIVE_INFINITY;
// 3 으로 올린 이유(2026-08-26): 후보를 고르는 조건 자체는 그대로다. 바뀐 것은 **산출물의
// 지표 집합**이다 — `return1d` 가 늘어 `indicator_snapshot` 의 형태가 달라졌고, 추천 프롬프트가
// 지표를 통째로 싣기 때문에 모델이 보는 입력도 달라졌다. 버전의 목적은 "규칙이 바뀌었다" 를
// 알리는 것보다 **섞어 보면 안 되는 경계**를 표시하는 것이므로, 그 경계를 여기에 둔다.
// 이 값을 안 올리면 배포 전후 추천이 같은 버전으로 집계돼 변화의 효과를 분리할 수 없다.
//
// 4 로 올린 이유(2026-09-01): 둘 다 바뀌었다.
// ① **순위 재료** — `high200Position` 의 기준이 최근 200봉의 **최고 종가**에서 **장중 최고가**로
//    바뀌었다. 두 전략 모두 이 값을 순위 재료로 쓰므로(LONG_TERM·SWING 각 3순위) 같은 종목·
//    같은 날이어도 순위가 달라진다. 장중에 찍고 내려온 고점이 이제 분모에 들어가 신고가 위치가
//    전반적으로 낮게 나오고, 위아래로 크게 흔들린 종목일수록 더 낮아진다.
// ② **산출물의 지표 집합** — `highFallbackBarCount` 가 늘어 `indicator_snapshot` 의 형태가
//    달라졌고, 추천 프롬프트가 지표를 통째로 싣기 때문에 모델이 보는 입력도 달라졌다
//    (버전 3 을 올린 것과 같은 이유다).
// 앞 버전의 추천과 한 칸에 모으면 이 재편을 성적 변화로 읽게 된다.
export const SCREENER_RULE_VERSION = 4;
export type ScreenStrategy = 'LONG_TERM' | 'SWING';
export type RankingWeights = readonly [number, number, number];
export const SWING_VOLUME_SURGE_MINIMUM = 1.5;
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = [1, 1, 1];

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

// 재료는 정확히 셋이다. 배열로 두면 재료를 넷으로 늘렸을 때 `rankingWeights[3]` 이
// undefined 가 되어 순위합이 통째로 NaN 이 되는데, NaN 은 정렬 비교가 전부 false 라
// 점수가 조용히 무너진다. 튜플로 고정하면 그 변경이 컴파일 단계에서 막힌다 —
// 재료를 늘리려면 `RankingWeights` 도 함께 늘려야 한다는 사실이 타입으로 강제된다.
type RankingMaterials = readonly [
  RankingMaterial,
  RankingMaterial,
  RankingMaterial,
];

const passesLongTerm = (candidate: ScreenCandidate): boolean => {
  const { close, ma120, isAligned } = candidate.indicators;
  return ma120 !== null && isAligned === true && close > ma120;
};

const passesSwing = (
  candidate: ScreenCandidate,
  volumeSurgeMinimum: number,
): boolean => {
  const { close, ma20, volumeSurge } = candidate.indicators;
  return (
    ma20 !== null &&
    close > ma20 &&
    volumeSurge !== null &&
    volumeSurge >= volumeSurgeMinimum
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

const materialsByStrategy: Record<ScreenStrategy, RankingMaterials> = {
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

const validateRankingWeights = (rankingWeights: RankingWeights): number => {
  if (
    rankingWeights.length !== 3 ||
    rankingWeights.some((weight) => !Number.isFinite(weight) || weight < 0)
  ) {
    throw new Error('순위 가중치는 유한한 0 이상 수 3개여야 합니다.');
  }
  const totalWeight = rankingWeights.reduce((sum, weight) => sum + weight, 0);
  // 성분이 각각 유한해도 합은 넘칠 수 있다(`[Number.MAX_VALUE, MAX_VALUE, 0]`).
  // 그 합으로 점수를 내면 분자·분모가 함께 Infinity 가 되어 NaN 이 나오는데,
  // 그것은 예외가 아니라 조용히 틀린 순위로 남는다.
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error('순위 가중치의 합은 0보다 큰 유한수여야 합니다.');
  }
  return totalWeight;
};

export const screenStocks = (
  candidates: ScreenCandidate[],
  strategy: ScreenStrategy,
  limit: number,
  // 백테스트가 하한을 바꿔가며 성적을 비교할 수 있도록 주입 가능하게 열어 둔다.
  // 기본값이 운영 규칙이므로 기존 호출부는 그대로 둔다.
  minimumTurnover60: number = MINIMUM_TURNOVER60,
  maximumDailyGainPercent: number = DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT,
  volumeSurgeMinimum: number = SWING_VOLUME_SURGE_MINIMUM,
  rankingWeights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): ScreenedStock[] => {
  const totalWeight = validateRankingWeights(rankingWeights);
  const passed = candidates.filter(
    (candidate) =>
      candidate.indicators.turnover60 !== null &&
      candidate.indicators.turnover60 >= minimumTurnover60 &&
      withinDailyGainCap(candidate, maximumDailyGainPercent) &&
      (strategy === 'LONG_TERM'
        ? passesLongTerm(candidate)
        : passesSwing(candidate, volumeSurgeMinimum)),
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
      (sum, ranks, index) =>
        sum + rankingWeights[index] * (ranks.get(candidate.code) as number),
      0,
    );
    const rawScore =
      candidateCount === 1
        ? 100
        : ((totalWeight * candidateCount - rankSum) /
            (totalWeight * candidateCount - totalWeight)) *
          100;
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
