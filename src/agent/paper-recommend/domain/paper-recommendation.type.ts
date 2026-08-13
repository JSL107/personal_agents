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
}

export interface ConstrainedPaperRecommendation {
  sells: PaperRecommendationSellIntent[];
  buys: PaperRecommendationBuyIntent[];
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
