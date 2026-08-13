import { MoneyValue } from '../../market-data/domain/market-data.type';

export interface PortfolioSnapshotInput {
  tradeDate: Date;
  totalValue: MoneyValue;
  isBackfilled: boolean;
}

export interface PortfolioTradeInput {
  quantity: MoneyValue;
  price: MoneyValue;
  fee: MoneyValue;
  tax: MoneyValue;
}

export interface CalculatePortfolioPerformanceInput {
  seedAmount: MoneyValue;
  snapshots: PortfolioSnapshotInput[];
  trades: PortfolioTradeInput[];
}

export interface PortfolioPerformance {
  snapshotCount: number;
  accountReturnRate: string | null;
  maximumDrawdown: string | null;
  turnoverRate: string | null;
  cumulativeCost: string;
}

export const calculatePortfolioPerformance = (
  input: CalculatePortfolioPerformanceInput,
): PortfolioPerformance => {
  const snapshots = input.snapshots
    .filter((snapshot) => !snapshot.isBackfilled)
    .sort(
      (left, right) => left.tradeDate.getTime() - right.tradeDate.getTime(),
    );
  const zero = input.seedAmount.times(0);
  const cumulativeCost = input.trades.reduce(
    (sum, trade) => sum.plus(trade.fee).plus(trade.tax),
    zero,
  );

  if (snapshots.length === 0) {
    return {
      snapshotCount: 0,
      accountReturnRate: null,
      maximumDrawdown: null,
      turnoverRate: null,
      cumulativeCost: cumulativeCost.toString(),
    };
  }

  const latestTotalValue = snapshots[snapshots.length - 1].totalValue;
  const accountReturnRate = latestTotalValue
    .dividedBy(input.seedAmount)
    .minus(1);
  let peakValue = input.seedAmount;
  let maximumDrawdown = zero;
  for (const snapshot of snapshots) {
    if (snapshot.totalValue.comparedTo(peakValue) > 0) {
      peakValue = snapshot.totalValue;
    }
    const drawdown = snapshot.totalValue.dividedBy(peakValue).minus(1);
    if (drawdown.comparedTo(maximumDrawdown) < 0) {
      maximumDrawdown = drawdown;
    }
  }

  const totalSnapshotValue = snapshots
    .slice(1)
    .reduce(
      (sum, snapshot) => sum.plus(snapshot.totalValue),
      snapshots[0].totalValue,
    );
  const averageSnapshotValue = totalSnapshotValue.dividedBy(snapshots.length);
  const totalTradeAmount = input.trades.reduce(
    (sum, trade) => sum.plus(trade.price.times(trade.quantity)),
    zero,
  );

  return {
    snapshotCount: snapshots.length,
    accountReturnRate: accountReturnRate.toString(),
    maximumDrawdown: maximumDrawdown.toString(),
    turnoverRate: averageSnapshotValue.isZero()
      ? null
      : totalTradeAmount.dividedBy(averageSnapshotValue).toString(),
    cumulativeCost: cumulativeCost.toString(),
  };
};
