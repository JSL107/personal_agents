import { MoneyValue } from '../../market-data/domain/market-data.type';
import { TradeSide } from './paper-account.type';

export interface InvariantInput {
  seedAmount: MoneyValue;
  cashBalance: MoneyValue;
  trades: {
    side: TradeSide;
    quantity: MoneyValue;
    price: MoneyValue;
    fee: MoneyValue;
    tax: MoneyValue;
    tickerId: number;
  }[];
  positions: { tickerId: number; quantity: MoneyValue }[];
  corporateActions?: {
    tickerId: number;
    cashDelta: MoneyValue;
    quantityDelta: MoneyValue;
  }[];
}

export interface InvariantViolation {
  kind: 'CASH_MISMATCH' | 'QUANTITY_MISMATCH';
  detail: string;
}

export const verifyPaperInvariants = (
  input: InvariantInput,
): InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  let expectedCash = input.seedAmount;
  const zero = input.seedAmount.times(0);
  const expectedQuantities = new Map<number, MoneyValue>();
  const corporateActions = input.corporateActions ?? [];

  for (const trade of input.trades) {
    const grossAmount = trade.quantity.times(trade.price);
    if (trade.side === 'BUY') {
      expectedCash = expectedCash.minus(
        grossAmount.plus(trade.fee).plus(trade.tax),
      );
    } else {
      expectedCash = expectedCash.plus(
        grossAmount.minus(trade.fee).minus(trade.tax),
      );
    }

    const currentQuantity = expectedQuantities.get(trade.tickerId) ?? zero;
    expectedQuantities.set(
      trade.tickerId,
      trade.side === 'BUY'
        ? currentQuantity.plus(trade.quantity)
        : currentQuantity.minus(trade.quantity),
    );
  }

  for (const corporateAction of corporateActions) {
    expectedCash = expectedCash.plus(corporateAction.cashDelta);
    const currentQuantity =
      expectedQuantities.get(corporateAction.tickerId) ?? zero;
    expectedQuantities.set(
      corporateAction.tickerId,
      currentQuantity.plus(corporateAction.quantityDelta),
    );
  }

  const corporateActionDetail =
    corporateActions.length > 0
      ? ` (기업행동 ${corporateActions.length}건 반영)`
      : '';

  if (expectedCash.comparedTo(input.cashBalance) !== 0) {
    violations.push({
      kind: 'CASH_MISMATCH',
      detail: `현금 잔액 불일치: 원장 기준 ${expectedCash.toString()}원, 실제 ${input.cashBalance.toString()}원${corporateActionDetail}`,
    });
  }

  const actualQuantities = new Map<number, MoneyValue>();
  for (const position of input.positions) {
    const currentQuantity = actualQuantities.get(position.tickerId) ?? zero;
    actualQuantities.set(
      position.tickerId,
      currentQuantity.plus(position.quantity),
    );
  }

  const tickerIds = new Set([
    ...expectedQuantities.keys(),
    ...actualQuantities.keys(),
  ]);
  for (const tickerId of [...tickerIds].sort((left, right) => left - right)) {
    const expectedQuantity = expectedQuantities.get(tickerId) ?? zero;
    const actualQuantity = actualQuantities.get(tickerId) ?? zero;
    if (expectedQuantity.comparedTo(actualQuantity) !== 0) {
      violations.push({
        kind: 'QUANTITY_MISMATCH',
        detail: `종목 ${tickerId} 수량 불일치: 원장 기준 ${expectedQuantity.toString()}주, 실제 ${actualQuantity.toString()}주${corporateActionDetail}`,
      });
    }
  }

  return violations;
};
