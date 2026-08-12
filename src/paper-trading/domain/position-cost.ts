import { MoneyValue } from '../../market-data/domain/market-data.type';
import { BuyOutcome, PositionState, SellOutcome } from './paper-account.type';

export interface BuyTradeInput {
  quantity: MoneyValue;
  price: MoneyValue;
  fee: MoneyValue;
}

export interface SellTradeInput extends BuyTradeInput {
  tax: MoneyValue;
}

export const applyBuy = (
  position: PositionState,
  trade: BuyTradeInput,
): BuyOutcome => {
  const quantity = position.quantity.plus(trade.quantity);
  const currentCost = position.quantity.times(position.avgPrice);
  const purchaseCost = trade.quantity.times(trade.price).plus(trade.fee);
  const avgPrice = currentCost.plus(purchaseCost).dividedBy(quantity);

  // 현금 잔액은 계좌 상태이므로 이 순수 원가 함수에서 검사하지 않고 usecase가 책임진다.
  return {
    quantity: quantity.toString(),
    avgPrice: avgPrice.toString(),
  };
};

export const applySell = (
  position: PositionState,
  trade: SellTradeInput,
): SellOutcome => {
  if (trade.quantity.comparedTo(position.quantity) > 0) {
    throw new Error(
      `보유 수량을 초과해 매도할 수 없습니다. 보유: ${position.quantity.toString()}, 매도: ${trade.quantity.toString()}`,
    );
  }

  const quantity = position.quantity.minus(trade.quantity);
  const proceeds = trade.quantity
    .times(trade.price)
    .minus(trade.fee)
    .minus(trade.tax);
  const soldCost = trade.quantity.times(position.avgPrice);

  return {
    quantity: quantity.toString(),
    avgPrice: position.avgPrice.toString(),
    realizedPnl: proceeds.minus(soldCost).toString(),
  };
};
