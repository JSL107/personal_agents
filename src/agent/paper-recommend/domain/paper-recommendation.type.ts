export type PaperRecommendationStrategy = 'LONG_TERM' | 'SWING';

export interface PaperRecommendationSell {
  code: string;
  reason: string;
}

export interface PaperRecommendationBuy {
  code: string;
  reason: string;
}

export interface PaperRecommendation {
  sells: PaperRecommendationSell[];
  buys: PaperRecommendationBuy[];
}

export interface PaperRecommendationCandidate {
  tickerId: number;
  code: string;
  name: string;
  close: number;
}

export interface PaperRecommendationPosition {
  tickerId: number;
  code: string;
  quantity: number;
}

export interface ConstrainPaperRecommendationInput {
  recommendation: PaperRecommendation;
  candidates: PaperRecommendationCandidate[];
  positions: PaperRecommendationPosition[];
  cashBalance: number;
  accountValuation: number;
  // 종목당 비중. 백테스트가 값을 바꿔가며 성적을 비교할 수 있도록 주입 가능하게 열어 둔다.
  // 생략하면 운영 상수(20%)를 쓰므로 기존 호출부는 그대로다.
  maximumWeightPercent?: number;
}

export interface PaperRecommendationSellIntent {
  side: 'SELL';
  tickerId: number;
  code: string;
  reason: string;
  quantity: number;
}

export interface PaperRecommendationBuyIntent {
  side: 'BUY';
  tickerId: number;
  code: string;
  name: string;
  reason: string;
  // 주문 생성에는 쓰이지 않는다. 코드가 어떤 비중을 배정했는지 드러내는 유일한 관측점이라
  // 테스트가 이 값으로 결정론을 단언한다 (수량으로 재면 종가에 얽매인다).
  weightPercent: number;
  quantity: number;
  close: number;
}

export type PaperRecommendationSkipReason =
  | 'ALREADY_HELD'
  | 'NOT_IN_CANDIDATES'
  | 'ZERO_WEIGHT'
  | 'INSUFFICIENT_CASH'
  | 'BUY_LIMIT_REACHED'
  | 'NOT_HELD'
  // 같은 종목의 미체결 매도 주문이 이미 있어 이번 회차에서 빠진 건.
  | 'PENDING_ORDER_EXISTS';

export interface PaperRecommendationSkip {
  side: 'BUY' | 'SELL';
  code: string;
  reason: PaperRecommendationSkipReason;
}

export interface ConstrainedPaperRecommendation {
  sells: PaperRecommendationSellIntent[];
  buys: PaperRecommendationBuyIntent[];
  skipped: PaperRecommendationSkip[];
}

export interface BuildPaperRecommendationPromptInput {
  strategy: PaperRecommendationStrategy;
  // 잔고가 아니라 지금 매수에 쓸 수 있는 금액. 배당은 권리락일에 잔고로 잡히지만 지급일
  // 전까지는 쓸 수 없어, 잔고를 실으면 모델이 받지도 않은 돈을 근거로 종목을 고른다.
  purchasableCash: number;
  accountValuation: number;
  // 이 회차에 배정될 종목당 비중. 시스템 프롬프트와 같은 값을 써야 한다 — 두 프롬프트가
  // 서로 다른 비중을 말하면 모델이 무엇을 기준으로 골랐는지 사후에 가릴 수 없다.
  maximumWeightPercent: number;
  positions: Array<{
    code: string;
    name: string;
    quantity: number;
    indicators: StockIndicators | null;
  }>;
  candidates: Array<{
    code: string;
    name: string;
    score: number;
    indicators: StockIndicators;
  }>;
}
import { StockIndicators } from '../../../market-data/domain/stock-indicator';
