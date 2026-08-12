// 아래 지표는 turnover60 을 빼고 전부 조정가(adjClose) 기준이다.
export interface IndicatorValues {
  lastTradeDate: string;
  // 사람이 보는 값이라 원본 종가를 싣는다. 계산에는 쓰지 않는다.
  lastClose: number;
  barCount: number;
  ma5: number;
  ma20: number;
  ma60: number;
  ma120: number;
  // ma5 > ma20 > ma60 — 단기가 장기 위에 놓인 상승 배열
  isAligned: boolean;
  // ma60 > ma120 — 중장기 추세가 살아 있는가
  isUptrend: boolean;
  // 현재 조정가 ÷ 20일선. 1보다 크면 20일선 위
  disparity20: number;
  // 최근 5일 평균 거래량 ÷ 60일 평균 거래량
  volumeSurge: number;
  return20: number;
  return60: number;
  return120: number;
  // 현재 조정가 ÷ 200일 최고 조정가. 1에 가까울수록 고점 부근
  high200Position: number;
  // 최근 20일 일간수익률의 표준편차 (연율화하지 않는다)
  volatility20: number;
  // 최근 60일 평균 거래대금 (원본 종가 × 거래량). 유동성 판정이라 조정가를 쓰지 않는다
  turnover60: number;
}

export interface StockIndicator extends IndicatorValues {
  tickerId: number;
  code: string;
  name: string;
  krxMarket: string | null;
}
