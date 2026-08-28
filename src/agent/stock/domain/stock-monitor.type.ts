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

// 경보선까지 남은 거리. 사건(StockAnomaly)도 상태(AvgPriceStatus)도 아닌 **여유**다 —
// 아직 아무 일도 일어나지 않은 종목에 대해서만 값이 있다. "새 경보 없음" 이 안전해서인지
// 간발의 차인지가 카드에 없어, 조용한 날과 아슬아슬한 날의 글자가 똑같던 것을 메운다.
export interface AlertMargin {
  tickerName: string;
  symbol: string;
  kind: StockAnomalyKind;
  // 지금 값(퍼센트). 일간 축은 전일 대비, 평단 축은 평균 매입가 대비다.
  currentPercent: number;
  // 그 축에서 가장 가까운 경보선(퍼센트).
  threshold: number;
  // 경보선까지 남은 폭(%p). 음수는 이미 넘은 것이므로 이 타입에 담지 않는다.
  marginPoint: number;
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
