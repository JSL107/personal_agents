import { MoneyValue } from '../../market-data/domain/market-data.type';

export type TradeSide = 'BUY' | 'SELL';
export type TradeStrategy = 'LONG_TERM' | 'SWING' | 'MANUAL';
export type OrderStatus =
  | 'PENDING'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'EXPIRED'
  | 'CANCELLED';
export type PaperMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX';

export const parseTradeSide = (value: string): TradeSide => {
  const normalized = value.toUpperCase();
  if (normalized === 'BUY' || normalized === 'SELL') {
    return normalized;
  }
  throw new Error(`매매 방향이 올바르지 않습니다. 받은 값: ${value}`);
};

export const parseTradeStrategy = (value: string): TradeStrategy => {
  const normalized = value.toUpperCase();
  if (
    normalized === 'LONG_TERM' ||
    normalized === 'SWING' ||
    normalized === 'MANUAL'
  ) {
    return normalized;
  }
  throw new Error(`투자 전략이 올바르지 않습니다. 받은 값: ${value}`);
};

export const parsePaperMarket = (value: string): PaperMarket => {
  const normalized = value.toUpperCase();
  if (
    normalized === 'KOSPI' ||
    normalized === 'KOSDAQ' ||
    normalized === 'KONEX'
  ) {
    return normalized;
  }
  throw new Error(`가상 매매 시장이 올바르지 않습니다. 받은 값: ${value}`);
};

// 국내 주식은 정수 주 단위다. 소수 수량은 존재할 수 없는 체결이므로 입구에서 막는다.
//
// 0 과 음수도 같은 자리에서 막는다. 수량 0 은 `applyBuy` 의 평균단가 계산에서 0 으로 나누기가
// 되어 avgPrice 가 Infinity/NaN 인 채로 적재되고, 음수 수량은 매수인데 현금이 늘어난다.
// 두 경우 모두 예외가 아니라 조용히 잘못된 장부로 남기 때문에 여기가 유일한 차단 지점이다.
export const assertWholeShares = (quantity: MoneyValue): void => {
  const value = quantity.toString();
  if (!/^-?\d+$/u.test(value)) {
    throw new Error(`국내 주식 수량은 정수여야 합니다. 받은 값: ${value}`);
  }
  if (quantity.comparedTo(0) <= 0) {
    throw new Error(
      `국내 주식 수량은 1주 이상이어야 합니다. 받은 값: ${value}`,
    );
  }
};

export interface TradeCostInput {
  market: PaperMarket;
  side: TradeSide;
  grossAmount: MoneyValue;
  tradeDate: Date;
}

export interface TradeCost {
  fee: string;
  tax: string;
}

export interface PositionState {
  quantity: MoneyValue;
  avgPrice: MoneyValue;
}

export interface BuyOutcome {
  quantity: string;
  avgPrice: string;
}

export interface SellOutcome {
  quantity: string;
  avgPrice: string;
  realizedPnl: string;
}

export interface PositionValuationInput {
  tickerId: number;
  quantity: MoneyValue;
  avgPrice: MoneyValue;
  price: MoneyValue;
  priceDate: Date;
}

export interface PositionValuation {
  tickerId: number;
  marketValue: string;
  costBasis: string;
  unrealizedPnl: string;
  returnRate: string;
  isStale: boolean;
}

export interface AccountValuationInput {
  seedAmount: MoneyValue;
  cashBalance: MoneyValue;
  tradeDate: Date;
  positions: PositionValuationInput[];
}

export interface AccountValuation {
  positions: PositionValuation[];
  positionValue: string;
  totalValue: string;
  returnRate: string;
  staleTickerCount: number;
}
