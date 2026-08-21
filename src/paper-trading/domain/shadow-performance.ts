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
  // 위 합계 중 "보유 기간이 아직 안 찼다" 인 건수. 그림자는 매수 후 전략별 고정 거래일
  // 뒤 종가로 팔았다고 가정하므로, 계좌를 연 지 얼마 안 됐으면 전건이 여기로 떨어진다.
  // 데이터가 깨진 것과 때가 안 된 것은 다른 사건인데 합계만 보면 구분되지 않는다.
  shadowNotDueCount: number;
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
  // 평가일 지수가 아직 안 들어온 회차인가. 초과수익은 진입일과 청산일 지수를 모두 요구하고
  // 보유 중인 추천은 청산일이 곧 평가일이라, 이 값이 참이면 전건이 집계에서 빠진다.
  // 개별 결손과 달리 회차 전체를 무효로 만드는 사건이라 따로 낸다 — 2026-08-19 채점이
  // 그날 지수 수집(18:30)보다 먼저 돌아 전건 제외로 원장에 박힌 적이 있다.
  evaluationBenchmarkMissing: boolean;
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
  let shadowNotDueCount = 0;
  // 미도래와 시세 결손을 가르려면 "그 거래일이 왔는가" 를 종목 밖에서 알아야 한다.
  // 조회 범위의 전 종목 봉에서 날짜만 모으면 그것이 곧 시장 거래일 축이다 — daily_price
  // 는 매 거래일 전 종목이 갱신되므로 한 종목이 비어도 축은 남는다. 이 축이 없으면
  // 상장폐지·거래정지로 봉이 끊긴 종목까지 "아직 대기 중" 으로 보고돼 장애가 묻힌다.
  const marketTradeDates = [
    ...new Set(
      input.dailyPrices.map((dailyPrice) => dailyPrice.tradeDate.getTime()),
    ),
  ].sort((left, right) => left - right);

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

    if (entryIndex < 0 || !entryDailyPrice) {
      shadowUnavailableCount += 1;
      continue;
    }
    if (!exitDailyPrice) {
      shadowUnavailableCount += 1;
      // 시장 축에서 그 거래일이 아직 안 왔으면 대기, 왔는데 이 종목 봉만 없으면 결손이다.
      // 후자를 대기로 세면 거래정지·상장폐지가 정상으로 보고된다.
      const entryMarketIndex = marketTradeDates.indexOf(
        entryDailyPrice.tradeDate.getTime(),
      );
      const horizonReached =
        entryMarketIndex >= 0 &&
        marketTradeDates.length >
          entryMarketIndex + SHADOW_HOLDING_ROWS[cycle.strategy];
      if (!horizonReached) {
        shadowNotDueCount += 1;
      }
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

  return { performances, shadowUnavailableCount, shadowNotDueCount };
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
  const evaluationBenchmarkMissing = !benchmarkCloseByDate.has(
    input.evaluationDate.getTime(),
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
    evaluationBenchmarkMissing,
  };
};
