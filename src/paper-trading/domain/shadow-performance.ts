import { MoneyValue } from '../../market-data/domain/market-data.type';
import { PaperMarket } from './paper-account.type';
import { RecommendationCycle } from './recommendation-score';
import { calculateTradeCost } from './trade-cost';

export interface ShadowDailyPriceInput {
  tickerId: number;
  market: PaperMarket;
  tradeDate: Date;
  close: MoneyValue;
}

export interface ShadowPerformance {
  orderId: number;
  strategy: RecommendationCycle['strategy'];
  entryTradeDate: Date;
  exitTradeDate: Date;
  entryClose: string;
  exitClose: string;
  returnRate: string;
}

export interface CalculateShadowPerformanceInput {
  cycles: RecommendationCycle[];
  dailyPrices: ShadowDailyPriceInput[];
}

export interface CalculateShadowPerformanceResult {
  performances: ShadowPerformance[];
  shadowUnavailableCount: number;
}

export interface BenchmarkCloseInput {
  tradeDate: Date;
  close: MoneyValue;
}

export interface BenchmarkPerformance {
  orderId: number;
  entryTradeDate: Date;
  exitTradeDate: Date;
  benchmarkReturnRate: string;
  excessReturnRate: string;
}

export interface CalculateBenchmarkPerformanceInput {
  cycles: RecommendationCycle[];
  evaluationDate: Date;
  dailyPrices: ShadowDailyPriceInput[];
  benchmarkCloses: BenchmarkCloseInput[];
}

export interface CalculateBenchmarkPerformanceResult {
  performances: BenchmarkPerformance[];
  meanExcessReturnRate: string | null;
  benchmarkUnavailableCount: number;
}

const SHADOW_HOLDING_ROWS: Record<RecommendationCycle['strategy'], number> = {
  LONG_TERM: 60,
  SWING: 5,
};

const sameDate = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime();

const compareDailyPrices = (
  left: ShadowDailyPriceInput,
  right: ShadowDailyPriceInput,
): number => left.tradeDate.getTime() - right.tradeDate.getTime();

export const calculateShadowPerformance = (
  input: CalculateShadowPerformanceInput,
): CalculateShadowPerformanceResult => {
  const performances: ShadowPerformance[] = [];
  let shadowUnavailableCount = 0;

  for (const cycle of input.cycles) {
    if (cycle.classification !== 'CLOSED' && cycle.classification !== 'OPEN') {
      continue;
    }
    if (!cycle.buyTrade) {
      shadowUnavailableCount += 1;
      continue;
    }

    const dailyPrices = input.dailyPrices
      .filter((dailyPrice) => dailyPrice.tickerId === cycle.tickerId)
      .sort(compareDailyPrices);
    const entryIndex = dailyPrices.findIndex((dailyPrice) =>
      sameDate(dailyPrice.tradeDate, cycle.buyTrade!.tradeDate),
    );
    const exitIndex = entryIndex + SHADOW_HOLDING_ROWS[cycle.strategy];
    const entryDailyPrice = dailyPrices[entryIndex];
    const exitDailyPrice = dailyPrices[exitIndex];

    if (entryIndex < 0 || !entryDailyPrice || !exitDailyPrice) {
      shadowUnavailableCount += 1;
      continue;
    }

    // 현재 adjusted=true 수집에서는 close == adjClose인 조정 계열이다.
    // 수집 정책이 바뀌면 양 끝 저장 close 계열과 그림자 계산 의미를 재검토해야 한다.
    const entryGrossAmount = entryDailyPrice.close.times(
      cycle.buyTrade.quantity,
    );
    const exitGrossAmount = exitDailyPrice.close.times(cycle.buyTrade.quantity);
    const entryCost = calculateTradeCost({
      market: entryDailyPrice.market,
      side: 'BUY',
      grossAmount: entryGrossAmount,
      tradeDate: entryDailyPrice.tradeDate,
    });
    const exitCost = calculateTradeCost({
      market: exitDailyPrice.market,
      side: 'SELL',
      grossAmount: exitGrossAmount,
      tradeDate: exitDailyPrice.tradeDate,
    });
    const entryTotal = entryGrossAmount.plus(entryCost.fee).plus(entryCost.tax);
    const exitTotal = exitGrossAmount.minus(exitCost.fee).minus(exitCost.tax);

    // 실제는 다음 거래일 시가, 그림자는 같은 거래일 저장 종가 진입이라 비교에는 진입 기준 차이도 섞인다.
    performances.push({
      orderId: cycle.orderId,
      strategy: cycle.strategy,
      entryTradeDate: entryDailyPrice.tradeDate,
      exitTradeDate: exitDailyPrice.tradeDate,
      entryClose: entryDailyPrice.close.toString(),
      exitClose: exitDailyPrice.close.toString(),
      returnRate: exitTotal.dividedBy(entryTotal).minus(1).toString(),
    });
  }

  return { performances, shadowUnavailableCount };
};

export const calculateBenchmarkPerformance = (
  input: CalculateBenchmarkPerformanceInput,
): CalculateBenchmarkPerformanceResult => {
  const benchmarkCloseByDate = new Map(
    input.benchmarkCloses.map((benchmarkClose) => [
      benchmarkClose.tradeDate.getTime(),
      benchmarkClose.close,
    ]),
  );
  const performances: BenchmarkPerformance[] = [];
  const excessReturnRates: MoneyValue[] = [];
  let benchmarkUnavailableCount = 0;

  for (const cycle of input.cycles) {
    if (!cycle.buyTrade) {
      continue;
    }

    let exitTradeDate: Date;
    let recommendationReturnRate: MoneyValue | null = null;
    if (
      cycle.classification === 'CLOSED' &&
      cycle.sellTrade &&
      cycle.actualReturnRate !== null
    ) {
      exitTradeDate = cycle.sellTrade.tradeDate;
      recommendationReturnRate = cycle.buyTrade.price
        .times(0)
        .plus(cycle.actualReturnRate);
    } else if (cycle.classification === 'OPEN') {
      exitTradeDate = input.evaluationDate;
      const valuationDailyPrice = input.dailyPrices.find(
        (dailyPrice) =>
          dailyPrice.tickerId === cycle.tickerId &&
          sameDate(dailyPrice.tradeDate, input.evaluationDate),
      );
      if (!valuationDailyPrice) {
        benchmarkUnavailableCount += 1;
        continue;
      }
      const entryGrossAmount = cycle.buyTrade.price.times(
        cycle.buyTrade.quantity,
      );
      const entryTotal = entryGrossAmount
        .plus(cycle.buyTrade.fee)
        .plus(cycle.buyTrade.tax);
      const exitGrossAmount = valuationDailyPrice.close.times(
        cycle.buyTrade.quantity,
      );
      const exitCost = calculateTradeCost({
        market: valuationDailyPrice.market,
        side: 'SELL',
        grossAmount: exitGrossAmount,
        tradeDate: input.evaluationDate,
      });
      const exitTotal = exitGrossAmount.minus(exitCost.fee).minus(exitCost.tax);
      recommendationReturnRate = exitTotal.dividedBy(entryTotal).minus(1);
    } else {
      continue;
    }

    const entryBenchmarkClose = benchmarkCloseByDate.get(
      cycle.buyTrade.tradeDate.getTime(),
    );
    const exitBenchmarkClose = benchmarkCloseByDate.get(
      exitTradeDate.getTime(),
    );
    if (!entryBenchmarkClose || !exitBenchmarkClose) {
      benchmarkUnavailableCount += 1;
      continue;
    }

    const benchmarkReturnRate = exitBenchmarkClose
      .dividedBy(entryBenchmarkClose)
      .minus(1);
    const excessReturnRate = benchmarkReturnRate
      .times(-1)
      .plus(recommendationReturnRate);
    excessReturnRates.push(excessReturnRate);
    performances.push({
      orderId: cycle.orderId,
      entryTradeDate: cycle.buyTrade.tradeDate,
      exitTradeDate,
      benchmarkReturnRate: benchmarkReturnRate.toString(),
      excessReturnRate: excessReturnRate.toString(),
    });
  }

  const meanExcessReturnRate =
    excessReturnRates.length === 0
      ? null
      : excessReturnRates
          .slice(1)
          .reduce(
            (sum, excessReturnRate) => sum.plus(excessReturnRate),
            excessReturnRates[0],
          )
          .dividedBy(excessReturnRates.length)
          .toString();

  return {
    performances,
    meanExcessReturnRate,
    benchmarkUnavailableCount,
  };
};
