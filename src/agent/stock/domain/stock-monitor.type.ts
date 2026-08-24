// 환율 원장(daily_fx_rate)의 통화쌍 키. 저장하는 쪽(저녁 감시)과 읽는 쪽(아침 브리핑)이
// 각자 리터럴을 들고 있으면 한쪽만 바뀌는 날 조회가 조용히 빈 결과를 낸다.
export const USD_KRW_PAIR = 'USDKRW';

import { DecimalValue } from '../../../market-data/domain/market-data.type';

export type StockAnomalyKind = 'DAILY_CHANGE' | 'AVG_PRICE_BREACH';
export type StockMarketCountry = 'KR' | 'US';

export interface StockAnomaly {
  tickerName: string;
  symbol: string;
  kind: StockAnomalyKind;
  ruleId: string;
  ruleVersion: number;
  // 발화를 유발한 실제 값(퍼센트).
  triggeredValue: number;
  // 넘어선 임계값(퍼센트).
  threshold: number;
  detail: string;
}

// 평단 대비가 지금 임계 밖이라는 **상태**. StockAnomaly(사건)와 다르다 — 알림 원장에 적재하지
// 않고 화면에만 쓴다. 사건은 한 번 일어나고 끝나지만 이 상태는 회복할 때까지 매일 참이다.
export interface AvgPriceStatus {
  tickerName: string;
  symbol: string;
  percent: number;
  threshold: number;
  // 아래 넷은 화면 설명용이다. 판정은 percent 하나로 끝나지만, 퍼센트만 보여주면
  // "얼마에 사서 지금 얼마이고 그래서 얼마를 잃고 있는지" 가 카드에 없다.
  avgPrice: number;
  currentPrice: number;
  quantity: number;
  currency: string;
}

export interface HoldingSnapshot {
  tickerName: string;
  symbol: string;
  quantity: DecimalValue;
  avgPrice: DecimalValue;
}

export interface StoredStockAlert {
  ruleId: string;
  ruleVersion: number;
  triggeredValue: number;
  threshold: number;
}
