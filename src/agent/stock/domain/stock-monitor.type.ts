import { DecimalValue } from '../../../market-data/domain/market-data.type';

export type StockAnomalyKind = 'DAILY_CHANGE' | 'AVG_PRICE_BREACH';
export type StockMarketCountry = 'KR' | 'US';

export interface StockAnomaly {
  tickerName: string;
  yahooSymbol: string;
  kind: StockAnomalyKind;
  ruleId: string;
  ruleVersion: number;
  // 발화를 유발한 실제 값(퍼센트).
  triggeredValue: number;
  // 넘어선 임계값(퍼센트).
  threshold: number;
  detail: string;
}

export interface HoldingSnapshot {
  tickerName: string;
  yahooSymbol: string;
  quantity: DecimalValue;
  avgPrice: DecimalValue;
}

export interface StoredStockAlert {
  ruleId: string;
  ruleVersion: number;
  triggeredValue: number;
  threshold: number;
}
