export type PaperRecommendationStrategy = 'LONG_TERM' | 'SWING';

export interface PaperRecommendationSell {
  code: string;
  reason: string;
}

export interface PaperRecommendationBuy {
  code: string;
  weightPercent: number;
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
  // 백테스트가 비중을 바꿔가며 성적을 비교할 수 있도록 상한을 주입 가능하게 열어 둔다.
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
  cashBalance: number;
  accountValuation: number;
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
