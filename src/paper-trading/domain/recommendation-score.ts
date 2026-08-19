import { MoneyValue } from '../../market-data/domain/market-data.type';
import { OrderStatus, TradeSide, TradeStrategy } from './paper-account.type';

export interface RecommendationOrderInput {
  id: number;
  accountId: number;
  tickerId: number;
  side: TradeSide;
  strategy: TradeStrategy;
  status: OrderStatus;
  quantity: MoneyValue;
  // 이 추천을 만든 스크리너 규칙 버전. 버전을 적기 전에 만들어진 추천은 null 이다.
  ruleVersion: number | null;
}

export interface RecommendationTradeInput {
  id: number;
  orderId: number | null;
  accountId: number;
  tickerId: number;
  side: TradeSide;
  quantity: MoneyValue;
  price: MoneyValue;
  fee: MoneyValue;
  tax: MoneyValue;
  realizedPnl: MoneyValue | null;
  tradeDate: Date;
}

export type RecommendationClassification =
  | 'CLOSED'
  | 'OPEN'
  | 'EXPIRED'
  | 'ANOMALY';

export interface RecommendationCycle {
  orderId: number;
  accountId: number;
  tickerId: number;
  strategy: Exclude<TradeStrategy, 'MANUAL'>;
  classification: RecommendationClassification;
  requestedQuantity: MoneyValue;
  buyTrade: RecommendationTradeInput | null;
  sellTrade: RecommendationTradeInput | null;
  actualPnl: string | null;
  actualReturnRate: string | null;
  holdingDays: number | null;
}

export type RecommendationScoreAnomalyType =
  | 'UNEXPECTED_ORDER_STATUS'
  | 'MISSING_BUY_TRADE'
  | 'MULTIPLE_BUY_TRADES'
  | 'UNMATCHED_SELL'
  | 'QUANTITY_MISMATCH'
  | 'REALIZED_PNL_MISMATCH';

export interface RecommendationScoreAnomaly {
  type: RecommendationScoreAnomalyType;
  orderId?: number;
  tradeId?: number;
  expected?: string;
  actual?: string;
}

export interface MatchRecommendationCyclesInput {
  orders: RecommendationOrderInput[];
  trades: RecommendationTradeInput[];
}

export interface MatchRecommendationCyclesResult {
  cycles: RecommendationCycle[];
  anomalies: RecommendationScoreAnomaly[];
  realizedPnlMismatchCount: number;
}

export interface StrategyRecommendationScore {
  strategy: Exclude<TradeStrategy, 'MANUAL'>;
  recommendationCount: number;
  closedCount: number;
  openCount: number;
  expiredCount: number;
  hitCount: number;
  hitRate: string | null;
  meanReturnRate: string | null;
  medianReturnRate: string | null;
  maximumLoss: string | null;
  averageHoldingDays: string | null;
  anomalyCount: number;
  realizedPnlMismatchCount: number;
}

interface ActualPerformance {
  pnl: MoneyValue;
  returnRate: MoneyValue;
}

const compareTrades = (
  left: RecommendationTradeInput,
  right: RecommendationTradeInput,
): number => {
  const dateDifference = left.tradeDate.getTime() - right.tradeDate.getTime();
  if (dateDifference !== 0) {
    return dateDifference;
  }
  return left.id - right.id;
};

const isAfter = (
  candidate: RecommendationTradeInput,
  reference: RecommendationTradeInput,
): boolean => compareTrades(candidate, reference) > 0;

const calculateActualPerformance = (
  buyTrade: RecommendationTradeInput,
  sellTrade: RecommendationTradeInput,
): ActualPerformance => {
  const entryTotal = buyTrade.price
    .times(buyTrade.quantity)
    .plus(buyTrade.fee)
    .plus(buyTrade.tax);
  const exitTotal = sellTrade.price
    .times(sellTrade.quantity)
    .minus(sellTrade.fee)
    .minus(sellTrade.tax);
  const pnl = exitTotal.minus(entryTotal);
  return {
    pnl,
    returnRate: pnl.dividedBy(entryTotal),
  };
};

const holdingDaysBetween = (entryDate: Date, exitDate: Date): number =>
  (exitDate.getTime() - entryDate.getTime()) / (24 * 60 * 60 * 1000);

const compareCycles = (
  left: RecommendationCycle,
  right: RecommendationCycle,
): number => {
  const accountDifference = left.accountId - right.accountId;
  if (accountDifference !== 0) {
    return accountDifference;
  }
  const tickerDifference = left.tickerId - right.tickerId;
  if (tickerDifference !== 0) {
    return tickerDifference;
  }
  if (left.buyTrade && right.buyTrade) {
    const tradeDifference = compareTrades(left.buyTrade, right.buyTrade);
    if (tradeDifference !== 0) {
      return tradeDifference;
    }
  } else if (left.buyTrade) {
    return -1;
  } else if (right.buyTrade) {
    return 1;
  }
  return left.orderId - right.orderId;
};

const recommendationOrders = (
  orders: RecommendationOrderInput[],
): Array<
  RecommendationOrderInput & {
    strategy: Exclude<TradeStrategy, 'MANUAL'>;
  }
> =>
  orders.filter(
    (
      order,
    ): order is RecommendationOrderInput & {
      strategy: Exclude<TradeStrategy, 'MANUAL'>;
    } =>
      order.side === 'BUY' &&
      (order.strategy === 'LONG_TERM' || order.strategy === 'SWING'),
  );

export const matchRecommendationCycles = (
  input: MatchRecommendationCyclesInput,
): MatchRecommendationCyclesResult => {
  const anomalies: RecommendationScoreAnomaly[] = [];
  const consumedSellTradeIds = new Set<number>();
  const sortedSellTrades = input.trades
    .filter((trade) => trade.side === 'SELL')
    .sort(compareTrades);
  const sortedRecommendationOrders = recommendationOrders(input.orders).sort(
    (left, right) => {
      const accountDifference = left.accountId - right.accountId;
      if (accountDifference !== 0) {
        return accountDifference;
      }
      const tickerDifference = left.tickerId - right.tickerId;
      if (tickerDifference !== 0) {
        return tickerDifference;
      }
      const leftBuyTrade = input.trades
        .filter((trade) => trade.side === 'BUY' && trade.orderId === left.id)
        .sort(compareTrades)[0];
      const rightBuyTrade = input.trades
        .filter((trade) => trade.side === 'BUY' && trade.orderId === right.id)
        .sort(compareTrades)[0];
      if (leftBuyTrade && rightBuyTrade) {
        const tradeDifference = compareTrades(leftBuyTrade, rightBuyTrade);
        if (tradeDifference !== 0) {
          return tradeDifference;
        }
      } else if (leftBuyTrade) {
        return -1;
      } else if (rightBuyTrade) {
        return 1;
      }
      return left.id - right.id;
    },
  );

  const cycles = sortedRecommendationOrders.map((order) => {
    const buyTrades = input.trades
      .filter(
        (trade) =>
          trade.side === 'BUY' &&
          trade.orderId === order.id &&
          trade.accountId === order.accountId &&
          trade.tickerId === order.tickerId,
      )
      .sort(compareTrades);

    if (order.status !== 'FILLED' && order.status !== 'EXPIRED') {
      anomalies.push({ type: 'UNEXPECTED_ORDER_STATUS', orderId: order.id });
      return {
        orderId: order.id,
        accountId: order.accountId,
        tickerId: order.tickerId,
        strategy: order.strategy,
        classification: 'ANOMALY' as const,
        requestedQuantity: order.quantity,
        buyTrade: buyTrades[0] ?? null,
        sellTrade: null,
        actualPnl: null,
        actualReturnRate: null,
        holdingDays: null,
      };
    }

    if (order.status === 'EXPIRED') {
      if (buyTrades.length > 0) {
        anomalies.push({
          type: 'UNEXPECTED_ORDER_STATUS',
          orderId: order.id,
        });
        return {
          orderId: order.id,
          accountId: order.accountId,
          tickerId: order.tickerId,
          strategy: order.strategy,
          classification: 'ANOMALY' as const,
          requestedQuantity: order.quantity,
          buyTrade: buyTrades[0],
          sellTrade: null,
          actualPnl: null,
          actualReturnRate: null,
          holdingDays: null,
        };
      }
      return {
        orderId: order.id,
        accountId: order.accountId,
        tickerId: order.tickerId,
        strategy: order.strategy,
        classification: 'EXPIRED' as const,
        requestedQuantity: order.quantity,
        buyTrade: null,
        sellTrade: null,
        actualPnl: null,
        actualReturnRate: null,
        holdingDays: null,
      };
    }

    const buyTrade = buyTrades[0] ?? null;
    if (!buyTrade) {
      anomalies.push({ type: 'MISSING_BUY_TRADE', orderId: order.id });
      return {
        orderId: order.id,
        accountId: order.accountId,
        tickerId: order.tickerId,
        strategy: order.strategy,
        classification: 'ANOMALY' as const,
        requestedQuantity: order.quantity,
        buyTrade: null,
        sellTrade: null,
        actualPnl: null,
        actualReturnRate: null,
        holdingDays: null,
      };
    }

    if (buyTrades.length > 1) {
      anomalies.push({ type: 'MULTIPLE_BUY_TRADES', orderId: order.id });
    }

    const sellTrade =
      sortedSellTrades.find(
        (trade) =>
          !consumedSellTradeIds.has(trade.id) &&
          trade.accountId === order.accountId &&
          trade.tickerId === order.tickerId &&
          isAfter(trade, buyTrade),
      ) ?? null;

    if (!sellTrade) {
      return {
        orderId: order.id,
        accountId: order.accountId,
        tickerId: order.tickerId,
        strategy: order.strategy,
        classification: 'OPEN' as const,
        requestedQuantity: order.quantity,
        buyTrade,
        sellTrade: null,
        actualPnl: null,
        actualReturnRate: null,
        holdingDays: null,
      };
    }

    consumedSellTradeIds.add(sellTrade.id);
    if (sellTrade.quantity.comparedTo(buyTrade.quantity) !== 0) {
      anomalies.push({
        type: 'QUANTITY_MISMATCH',
        orderId: order.id,
        tradeId: sellTrade.id,
        expected: buyTrade.quantity.toString(),
        actual: sellTrade.quantity.toString(),
      });
    }

    const performance = calculateActualPerformance(buyTrade, sellTrade);
    if (
      sellTrade.realizedPnl &&
      sellTrade.realizedPnl.comparedTo(performance.pnl) !== 0
    ) {
      anomalies.push({
        type: 'REALIZED_PNL_MISMATCH',
        orderId: order.id,
        tradeId: sellTrade.id,
        expected: performance.pnl.toString(),
        actual: sellTrade.realizedPnl.toString(),
      });
    }

    return {
      orderId: order.id,
      accountId: order.accountId,
      tickerId: order.tickerId,
      strategy: order.strategy,
      classification: 'CLOSED' as const,
      requestedQuantity: order.quantity,
      buyTrade,
      sellTrade,
      actualPnl: performance.pnl.toString(),
      actualReturnRate: performance.returnRate.toString(),
      holdingDays: holdingDaysBetween(buyTrade.tradeDate, sellTrade.tradeDate),
    };
  });

  for (const sellTrade of sortedSellTrades) {
    if (!consumedSellTradeIds.has(sellTrade.id)) {
      anomalies.push({ type: 'UNMATCHED_SELL', tradeId: sellTrade.id });
    }
  }

  return {
    cycles: cycles.sort(compareCycles),
    anomalies,
    realizedPnlMismatchCount: anomalies.filter(
      (anomaly) => anomaly.type === 'REALIZED_PNL_MISMATCH',
    ).length,
  };
};

const meanMoneyValues = (values: MoneyValue[]): string | null => {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce(
    (sum, value) => sum.plus(value),
    values[0].times(0),
  );
  return total.dividedBy(values.length).toString();
};

const scoreStrategy = (
  strategy: Exclude<TradeStrategy, 'MANUAL'>,
  result: MatchRecommendationCyclesResult,
): StrategyRecommendationScore | null => {
  const cycles = result.cycles.filter((cycle) => cycle.strategy === strategy);
  if (cycles.length === 0) {
    return null;
  }
  const closedCycles = cycles.filter(
    (
      cycle,
    ): cycle is RecommendationCycle & {
      buyTrade: RecommendationTradeInput;
      sellTrade: RecommendationTradeInput;
      holdingDays: number;
    } =>
      cycle.classification === 'CLOSED' &&
      cycle.buyTrade !== null &&
      cycle.sellTrade !== null &&
      cycle.holdingDays !== null,
  );
  const performances = closedCycles.map((cycle) =>
    calculateActualPerformance(cycle.buyTrade, cycle.sellTrade),
  );
  const returnRates = performances.map((performance) => performance.returnRate);
  const sortedReturnRates = [...returnRates].sort((left, right) =>
    left.comparedTo(right),
  );
  const lossReturnRates = sortedReturnRates.filter(
    (returnRate) => returnRate.comparedTo(0) < 0,
  );
  const hitCount = performances.filter(
    (performance) => performance.pnl.comparedTo(0) > 0,
  ).length;
  const zero = closedCycles[0]?.buyTrade.price.times(0) ?? null;
  const hitRate = zero
    ? zero.plus(hitCount).dividedBy(closedCycles.length).toString()
    : null;
  const middle = Math.floor(sortedReturnRates.length / 2);
  const medianReturnRate =
    sortedReturnRates.length === 0
      ? null
      : sortedReturnRates.length % 2 === 1
        ? sortedReturnRates[middle].toString()
        : sortedReturnRates[middle - 1]
            .plus(sortedReturnRates[middle])
            .dividedBy(2)
            .toString();
  const averageHoldingDays = zero
    ? zero
        .plus(
          closedCycles.reduce((total, cycle) => total + cycle.holdingDays, 0),
        )
        .dividedBy(closedCycles.length)
        .toString()
    : null;
  const orderIds = new Set(cycles.map((cycle) => cycle.orderId));
  const tradeIds = new Set(
    cycles.flatMap((cycle) =>
      [cycle.buyTrade?.id, cycle.sellTrade?.id].filter(
        (id): id is number => id !== undefined,
      ),
    ),
  );
  const strategyAnomalies = result.anomalies.filter(
    (anomaly) =>
      (anomaly.orderId !== undefined && orderIds.has(anomaly.orderId)) ||
      (anomaly.tradeId !== undefined && tradeIds.has(anomaly.tradeId)),
  );

  return {
    strategy,
    recommendationCount: cycles.length,
    closedCount: closedCycles.length,
    openCount: cycles.filter((cycle) => cycle.classification === 'OPEN').length,
    expiredCount: cycles.filter((cycle) => cycle.classification === 'EXPIRED')
      .length,
    hitCount,
    hitRate,
    meanReturnRate: meanMoneyValues(returnRates),
    medianReturnRate,
    maximumLoss: lossReturnRates[0]?.toString() ?? null,
    averageHoldingDays,
    anomalyCount: strategyAnomalies.length,
    realizedPnlMismatchCount: strategyAnomalies.filter(
      (anomaly) => anomaly.type === 'REALIZED_PNL_MISMATCH',
    ).length,
  };
};

export const aggregateRecommendationScores = (
  result: MatchRecommendationCyclesResult,
): StrategyRecommendationScore[] =>
  (['LONG_TERM', 'SWING'] as const).flatMap((strategy) => {
    const score = scoreStrategy(strategy, result);
    return score ? [score] : [];
  });
