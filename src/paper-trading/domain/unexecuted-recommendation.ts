import { MoneyValue } from '../../market-data/domain/market-data.type';
import { RecommendationCycle } from './recommendation-score';
import {
  BenchmarkCloseInput,
  calculateCloseToCloseReturnRate,
  SHADOW_HOLDING_ROWS,
  ShadowDailyPriceInput,
} from './shadow-performance';

export const UNEXECUTED_NOTIONAL_AMOUNT = 2_000_000;

export interface UnexecutedRecommendationInput {
  agentRunId: number;
  strategy: RecommendationCycle['strategy'];
  tickerId: number | null;
  code: string;
  recommendedOn: Date;
}

export interface CalculateUnexecutedRecommendationsInput {
  strategy: RecommendationCycle['strategy'];
  recommendations: UnexecutedRecommendationInput[];
  dailyPrices: ShadowDailyPriceInput[];
  benchmarkCloses: BenchmarkCloseInput[];
}

export interface UnexecutedRecommendationScore {
  recommendationCount: number;
  duplicateCount: number;
  unresolvedCount: number;
  scoredCount: number;
  notDueCount: number;
  unavailableCount: number;
  hitCount: number;
  hitRate: string | null;
  meanReturnRate: string | null;
  meanExcessReturnRate: string | null;
  benchmarkUnavailableCount: number;
}

const mean = (values: MoneyValue[]): string | null => {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce(
    (sum, value) => sum.plus(value),
    values[0].times(0),
  );
  return total.dividedBy(values.length).toString();
};

export const calculateUnexecutedRecommendations = (
  input: CalculateUnexecutedRecommendationsInput,
): UnexecutedRecommendationScore => {
  const recommendations = input.recommendations
    .filter((recommendation) => recommendation.strategy === input.strategy)
    .sort(
      (left, right) =>
        left.recommendedOn.getTime() - right.recommendedOn.getTime(),
    );
  const marketTradeDates = [
    ...new Set(
      input.dailyPrices.map((dailyPrice) => dailyPrice.tradeDate.getTime()),
    ),
  ].sort((left, right) => left - right);
  const dailyPricesByTicker = new Map<number, ShadowDailyPriceInput[]>();
  for (const dailyPrice of input.dailyPrices) {
    const prices = dailyPricesByTicker.get(dailyPrice.tickerId) ?? [];
    prices.push(dailyPrice);
    dailyPricesByTicker.set(dailyPrice.tickerId, prices);
  }
  for (const prices of dailyPricesByTicker.values()) {
    prices.sort(
      (left, right) => left.tradeDate.getTime() - right.tradeDate.getTime(),
    );
  }
  const benchmarkCloseByDate = new Map(
    input.benchmarkCloses.map((benchmarkClose) => [
      benchmarkClose.tradeDate.getTime(),
      benchmarkClose.close,
    ]),
  );
  const previousAcceptedMarketIndex = new Map<number, number>();
  const returnRates: MoneyValue[] = [];
  const excessReturnRates: MoneyValue[] = [];
  let duplicateCount = 0;
  let unresolvedCount = 0;
  let notDueCount = 0;
  let unavailableCount = 0;
  let hitCount = 0;
  let benchmarkUnavailableCount = 0;

  for (const recommendation of recommendations) {
    if (recommendation.tickerId === null) {
      unresolvedCount += 1;
      continue;
    }
    const entryTime = recommendation.recommendedOn.getTime();
    const entryMarketIndex = marketTradeDates.indexOf(entryTime);
    const previousIndex = previousAcceptedMarketIndex.get(
      recommendation.tickerId,
    );
    if (
      previousIndex !== undefined &&
      entryMarketIndex >= 0 &&
      entryMarketIndex - previousIndex < SHADOW_HOLDING_ROWS[input.strategy]
    ) {
      duplicateCount += 1;
      continue;
    }

    const prices = dailyPricesByTicker.get(recommendation.tickerId) ?? [];
    const entryIndex = prices.findIndex(
      (price) => price.tradeDate.getTime() === entryTime,
    );
    if (entryIndex < 0) {
      unavailableCount += 1;
      continue;
    }
    previousAcceptedMarketIndex.set(recommendation.tickerId, entryMarketIndex);
    const entryDailyPrice = prices[entryIndex];
    const exitDailyPrice =
      prices[entryIndex + SHADOW_HOLDING_ROWS[input.strategy]];
    if (!exitDailyPrice) {
      if (
        entryMarketIndex < 0 ||
        marketTradeDates.length <=
          entryMarketIndex + SHADOW_HOLDING_ROWS[input.strategy]
      ) {
        notDueCount += 1;
      } else {
        unavailableCount += 1;
      }
      continue;
    }

    const quantity = Math.max(
      1,
      Math.floor(UNEXECUTED_NOTIONAL_AMOUNT / entryDailyPrice.close.toNumber()),
    );
    const returnRate = calculateCloseToCloseReturnRate(
      entryDailyPrice,
      exitDailyPrice,
      quantity,
    );
    returnRates.push(returnRate);
    if (returnRate.comparedTo(0) > 0) {
      hitCount += 1;
    }

    const entryBenchmarkClose = benchmarkCloseByDate.get(entryTime);
    const exitBenchmarkClose = benchmarkCloseByDate.get(
      exitDailyPrice.tradeDate.getTime(),
    );
    if (!entryBenchmarkClose || !exitBenchmarkClose) {
      benchmarkUnavailableCount += 1;
      continue;
    }
    const benchmarkReturnRate = exitBenchmarkClose
      .dividedBy(entryBenchmarkClose)
      .minus(1);
    excessReturnRates.push(returnRate.minus(benchmarkReturnRate));
  }

  const scoredCount = returnRates.length;
  return {
    recommendationCount: recommendations.length,
    duplicateCount,
    unresolvedCount,
    scoredCount,
    notDueCount,
    unavailableCount,
    hitCount,
    hitRate:
      scoredCount === 0
        ? null
        : returnRates[0]
            .times(0)
            .plus(hitCount)
            .dividedBy(scoredCount)
            .toString(),
    meanReturnRate: mean(returnRates),
    meanExcessReturnRate: mean(excessReturnRates),
    benchmarkUnavailableCount,
  };
};
