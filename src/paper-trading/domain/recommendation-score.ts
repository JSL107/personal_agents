import { MoneyValue } from '../../market-data/domain/market-data.type';
import { formatExitBandLabel } from './exit-band';
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

// 장부의 realizedPnl 은 포지션 평단으로 계산되고 채점은 매수 체결가로 계산한다. 평단은
// 나눗셈이라 소수 4자리로 저장되면서 주당 최대 0.00005 원이 잘리고, 그 잔여가 수량만큼
// 쌓여 두 값의 끝자리가 갈린다. 완전 일치를 요구하면 이 잔여가 전부 이상치로 잡힌다 —
// 2026-08-20 기준 청산 13건 중 10건이 그랬고, 실측 차이는 전부 주당 0.00005 원 이하였다.
// 오탐이 이상치의 전부를 차지하면 진짜 불일치가 그 안에 묻힌다.
// 허용치는 저장 정밀도에서 나온 값이다 — 주당 0.0001 원은 반올림 한계의 두 배다.
const PNL_TOLERANCE_PER_SHARE = '0.0001';

const exceedsPnlTolerance = (
  recorded: MoneyValue,
  computed: MoneyValue,
  quantity: MoneyValue,
): boolean => {
  const difference = recorded.minus(computed);
  const absolute = difference.isNegative() ? difference.times(-1) : difference;
  return absolute.comparedTo(quantity.times(PNL_TOLERANCE_PER_SHARE)) > 0;
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
      exceedsPnlTolerance(
        sellTrade.realizedPnl,
        performance.pnl,
        sellTrade.quantity,
      )
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

/**
 * 밴드가 만들지 않은 매도(모델이 고른 매도)를 담는 구간 라벨.
 *
 * 밴드 성적의 분모에서 빼야 하는 매도라 별도 구간으로 센다. 지우면 밴드 하나로 닫힌
 * 표본처럼 읽힌다(`summarizeExitBandUsage` 의 `bandlessSellCount` 와 같은 이유).
 */
export const BANDLESS_PERIOD_LABEL = 'BANDLESS';

/** 사이클을 구간에 귀속시키기 위해 필요한 매도 주문 정보. */
export interface CycleExitBandRecord {
  id: number;
  takeProfitPercent: string | null;
  stopLossPercent: string | null;
}

export interface ExitBandPeriodCycles {
  periodLabel: string;
  cycles: RecommendationCycle[];
}

// 밴드 라벨(`+10/-5`)을 크기로 견준다. 파싱에 실패하면(BANDLESS 등) 뒤로 보낸다.
const parseExitBandLabel = (
  label: string,
): { takeProfitPercent: number; stopLossPercent: number } | null => {
  const matched = /^\+(-?[\d.]+)\/(-?[\d.]+)$/.exec(label);
  if (matched === null) {
    return null;
  }
  return {
    takeProfitPercent: Number(matched[1]),
    stopLossPercent: Number(matched[2]),
  };
};

const compareExitBandLabels = (left: string, right: string): number => {
  const leftBand = parseExitBandLabel(left);
  const rightBand = parseExitBandLabel(right);
  if (leftBand === null || rightBand === null) {
    if (leftBand === rightBand) {
      return left.localeCompare(right);
    }
    return leftBand === null ? 1 : -1;
  }
  const takeProfitDifference =
    leftBand.takeProfitPercent - rightBand.takeProfitPercent;
  if (takeProfitDifference !== 0) {
    return takeProfitDifference;
  }
  // 익절이 같으면 손절이 0 에 가까운 쪽이 좁은 밴드다(손절은 음수).
  return rightBand.stopLossPercent - leftBand.stopLossPercent;
};

/**
 * 사이클을 청산 밴드별로 가른다.
 *
 * 귀속은 **매도 주문**이 정한다. 옛 밴드로 사서 새 밴드로 팔린 건은 새 밴드 구간에 들어간다 —
 * 청산 결과를 만든 것이 매도 규칙이기 때문이다. 매수 시점으로 가르면 규칙을 바꾼 날을 걸친
 * 사이클이 어느 쪽 성적도 아니게 된다.
 *
 * 매도가 없는 사이클(미청산·만료)은 **어느 구간에도 넣지 않는다**. 귀속 근거가 없다.
 * 그래서 구간별 청산 건수의 합은 누적 행의 추천 건수보다 작다 — 결함이 아니다.
 */
export const splitCyclesByExitBand = (
  cycles: readonly RecommendationCycle[],
  sellOrders: readonly CycleExitBandRecord[],
): ExitBandPeriodCycles[] => {
  const bandByOrderId = new Map<number, string>();
  for (const order of sellOrders) {
    bandByOrderId.set(
      order.id,
      order.takeProfitPercent === null || order.stopLossPercent === null
        ? BANDLESS_PERIOD_LABEL
        : formatExitBandLabel({
            takeProfitPercent: Number(order.takeProfitPercent),
            stopLossPercent: Number(order.stopLossPercent),
          }),
    );
  }

  const grouped = new Map<string, RecommendationCycle[]>();
  for (const cycle of cycles) {
    const sellOrderId = cycle.sellTrade?.orderId;
    if (sellOrderId === undefined || sellOrderId === null) {
      continue;
    }
    const label = bandByOrderId.get(sellOrderId);
    // 매도 체결은 있는데 그 주문이 표본에 없다 — 로드 조건(체결 상태·결정일)에서 빠진
    // 주문이다. 임의로 BANDLESS 에 넣으면 밴드 없는 매도 건수가 부풀려지므로 제외한다.
    if (label === undefined) {
      continue;
    }
    const bucket = grouped.get(label);
    if (bucket === undefined) {
      grouped.set(label, [cycle]);
      continue;
    }
    bucket.push(cycle);
  }

  // 정렬은 누적 행의 `exitBands`(`summarizeExitBandUsage`)와 같은 규칙을 쓴다. 문자열 순으로
  // 세우면 같은 두 밴드가 누적에서는 `+2/-0.2, +10/-5`, 구간에서는 `+10/-5, +2/-0.2` 로 뒤집혀
  // 보인다. BANDLESS 는 밴드가 아니므로 크기 비교 대상이 아니라 맨 뒤에 둔다.
  return [...grouped.entries()]
    .map(([periodLabel, periodCycles]) => ({
      periodLabel,
      cycles: periodCycles,
    }))
    .sort((left, right) =>
      compareExitBandLabels(left.periodLabel, right.periodLabel),
    );
};

/**
 * 채점 회차 한 건의 요약. 프롬프트 되먹임이 읽는 최소 필드다.
 *
 * `RecommendationScore` 한 행은 **계좌 개설 이후 그 기준일까지의 누적**이다
 * (`prisma/schema.prisma` 의 `asOf` 주석). 행끼리 더하면 같은 청산이 두 번 세어진다.
 */
export interface RecommendationScoreSummary {
  asOf: Date;
  closedCount: number;
  hitCount: number;
  meanReturnRate: number | null;
  meanExcessReturnRate: number | null;
  maximumLoss: number | null;
}
