import { MoneyValue } from '../../market-data/domain/market-data.type';
import {
  AccountValuation,
  AccountValuationInput,
  PositionValuation,
  PositionValuationInput,
} from './paper-account.type';

const tradeDateText = (date: Date): string => date.toISOString().slice(0, 10);

const calculateReturnRate = (
  currentValue: MoneyValue,
  baseValue: MoneyValue,
): string => {
  if (baseValue.isZero()) {
    return '0';
  }
  return currentValue
    .minus(baseValue)
    .dividedBy(baseValue)
    .times(100)
    .toString();
};

export const calculatePositionValuation = (
  input: PositionValuationInput,
  tradeDate: Date,
): PositionValuation => {
  const marketValue = input.quantity.times(input.price);
  const costBasis = input.quantity.times(input.avgPrice);

  return {
    tickerId: input.tickerId,
    marketValue: marketValue.toString(),
    costBasis: costBasis.toString(),
    unrealizedPnl: marketValue.minus(costBasis).toString(),
    returnRate: calculateReturnRate(marketValue, costBasis),
    isStale: tradeDateText(input.priceDate) !== tradeDateText(tradeDate),
  };
};

export const calculateAccountValuation = (
  input: AccountValuationInput,
): AccountValuation => {
  const positions = input.positions.map((position) =>
    calculatePositionValuation(position, input.tradeDate),
  );
  const zero = input.cashBalance.times(0);
  const positionValue = positions.reduce<MoneyValue>(
    (total, position) => total.plus(position.marketValue),
    zero,
  );
  const totalValue = input.cashBalance.plus(positionValue);

  return {
    positions,
    positionValue: positionValue.toString(),
    totalValue: totalValue.toString(),
    returnRate: calculateReturnRate(totalValue, input.seedAmount),
    staleTickerCount: positions.filter((position) => position.isStale).length,
  };
};
