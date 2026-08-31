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

interface PendingCashAction {
  // 지급일. 배당은 권리락일에 원장에 적히지만 실제 입금은 이 날이다.
  payDate: Date | null;
  cashDelta: MoneyValue;
}

interface SummarizePendingDividendsInput {
  asOf: Date;
  zero: MoneyValue;
  corporateActions: PendingCashAction[];
}

export interface PendingDividendSummary {
  amount: MoneyValue;
  count: number;
  // 미도래 건 중 가장 이른 지급일. 여러 건이면 나머지는 그 뒤에 들어온다.
  nextPayDate: Date | null;
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

// 지급일이 아직 오지 않은 배당의 합·건수·가장 이른 지급일. 배당은 권리락일에 원장에 적히지만
// 실제 입금은 지급일이라(코람코더원리츠는 그 사이가 석 달이다) cashBalance 에는 아직 쓸 수 없는
// 돈이 섞인다. 그대로 매수 여력으로 쓰면 받지도 않은 돈으로 사는 주문이 만들어진다.
//
// 지급일에 미수금을 현금으로 바꾸는 예약 작업을 두지 않는다 — 그날 실행이 누락되면 배당이 조용히
// 사라지고, 그게 애초에 즉시 입금을 택했던 이유였다. 대신 읽을 때마다 오늘과 비교한다. 지급일이
// 지나면 이 합에서 저절로 빠지므로 상태를 바꿀 일이 없고, 따라서 누락될 경로도 없다.
//
// 셋을 한 함수가 내는 것은 의도다. 합과 지급일을 따로 구하던 동안 한쪽만 cashDelta 를 보아,
// 현금이 움직이지 않는 분할의 지급일이 배당 합계의 예고 날짜로 표시되는 결함이 있었다.
//
// 세는 조건은 둘이다 — 지급일이 미래일 것, 그리고 현금을 실제로 움직일 것. payDate 가 없는 건은
// 지급일 미상이라 즉시 입금으로 본다(기존 동작 유지). 종류를 가리지 않는 것도 의도다: 분할·병합은
// cashDelta 가 0 이라 걸러지고, 뒷날 현금이 나가는 기업행동이 생기면 같은 규칙을 그대로 탄다.
export const summarizePendingDividends = ({
  asOf,
  zero,
  corporateActions,
}: SummarizePendingDividendsInput): PendingDividendSummary =>
  corporateActions.reduce<PendingDividendSummary>(
    (summary, corporateAction) => {
      const { payDate } = corporateAction;
      if (
        payDate === null ||
        payDate.getTime() <= asOf.getTime() ||
        corporateAction.cashDelta.isZero()
      ) {
        return summary;
      }
      return {
        amount: summary.amount.plus(corporateAction.cashDelta),
        count: summary.count + 1,
        nextPayDate:
          summary.nextPayDate === null ||
          payDate.getTime() < summary.nextPayDate.getTime()
            ? payDate
            : summary.nextPayDate,
      };
    },
    { amount: zero, count: 0, nextPayDate: null },
  );

// 잔고에서 미수 배당을 뺀, 지금 실제로 매수에 쓸 수 있는 금액. 총평가액과 수익률은 잔고
// 전액으로 계산한다 — 받을 배당도 자산이라 거기서 빼면 지급일까지 계좌가 실제보다 나빠
// 보이고, 그건 지금과 반대 방향의 왜곡이다. 달라지는 것은 이 값 하나뿐이다.
//
// 미수분이 잔고보다 클 수 있다. 그 돈으로 낸 매수가 이미 체결된 계좌가 그렇다 — 음수를
// 그대로 흘리면 제약 함수가 0 으로 깎기 전까지 여력처럼 돌아다닌다.
export const calculatePurchasableCash = (input: {
  cashBalance: MoneyValue;
  pendingDividendCash: MoneyValue;
}): MoneyValue => {
  const purchasable = input.cashBalance.minus(input.pendingDividendCash);
  return purchasable.comparedTo(0) < 0
    ? input.cashBalance.times(0)
    : purchasable;
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
