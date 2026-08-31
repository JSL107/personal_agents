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

export const parseTradeDate = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`체결일은 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${value}`);
  }
  const tradeDate = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(tradeDate.getTime()) ||
    tradeDate.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`유효하지 않은 체결일입니다. 받은 값: ${value}`);
  }
  return tradeDate;
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
  // 보유분의 평가손익. 카드가 종목별로만 보여주던 값이라 합계를 읽는 곳이 없었다.
  unrealizedPnl: string;
  // 이미 팔아 확정한 손익. 카드에 없어서 "보유 종목은 전부 +인데 총 수익률은 -13%" 라는
  // 읽을 수 없는 화면이 나왔다(2026-08-28). 매도 원장을 다시 더하지 않고 항등식으로 구한다 —
  // 현금은 시드에서 매수를 빼고 매도를 더한 값이므로, 총손익에서 평가손익을 빼면 남는 것이
  // 실현손익이다. 수수료·세금도 현금에 이미 반영돼 있어 함께 들어온다.
  realizedPnl: string;
  staleTickerCount: number;
}
