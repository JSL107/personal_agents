import { MoneyValue } from '../../market-data/domain/market-data.type';
import {
  AccountValuation,
  AccountValuationInput,
  PositionValuation,
  PositionValuationInput,
  TradeSide,
} from './paper-account.type';

interface UnsettledTrade {
  side: TradeSide;
  quantity: MoneyValue;
  price: MoneyValue;
  fee: MoneyValue;
  tax: MoneyValue;
  settlementDate: Date | null;
}

interface CalculateUnsettledCashInput {
  asOf: Date;
  // 거래가 한 건도 없는 계좌(갓 개설한 계좌)에서도 0 을 낼 수 있어야 한다. MoneyValue 는
  // 도메인이 Prisma 에 의존하지 않도록 인터페이스로만 받으므로 스스로 0 을 만들 수 없어,
  // 호출부가 cashBalance.times(0) 같은 기준값을 함께 넘긴다. 빈 배열을 호출부가 미리
  // 걸러내게 두면 그 방어를 새 호출부마다 다시 기억해야 한다.
  zero: MoneyValue;
  trades: UnsettledTrade[];
}

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
  const unrealizedPnl = positions.reduce<MoneyValue>(
    (total, position) => total.plus(position.unrealizedPnl),
    zero,
  );

  return {
    positions,
    positionValue: positionValue.toString(),
    totalValue: totalValue.toString(),
    returnRate: calculateReturnRate(totalValue, input.seedAmount),
    unrealizedPnl: unrealizedPnl.toString(),
    realizedPnl: totalValue
      .minus(input.seedAmount)
      .minus(unrealizedPnl)
      .toString(),
    staleTickerCount: positions.filter((position) => position.isStale).length,
  };
};

// 결제일이 아직 오지 않은 거래들의 현금 효과 합. 매도가 +, 매수가 −.
// cashBalance는 체결 즉시 반영되므로, 결제 완료 예수금 = cashBalance − unsettledCash다.
export const calculateUnsettledCash = ({
  asOf,
  zero,
  trades,
}: CalculateUnsettledCashInput): MoneyValue =>
  trades.reduce<MoneyValue>((total, trade) => {
    if (
      trade.settlementDate === null ||
      trade.settlementDate.getTime() <= asOf.getTime()
    ) {
      return total;
    }
    const grossAmount = trade.quantity.times(trade.price);
    const cashEffect =
      trade.side === 'BUY'
        ? grossAmount.plus(trade.fee).plus(trade.tax).times(-1)
        : grossAmount.minus(trade.fee).minus(trade.tax);
    return total.plus(cashEffect);
  }, zero);
