// SWING 신규 매수 보류 게이트. KOSPI 종가가 20일 이동평균 이하인 날의 SWING 후보는
// 5거래일 평균 -6.1%(위인 날 -0.7%)였다. 효과는 아직 미검증이라 판정 근거를 전량 남긴다.
export const MARKET_REGIME_MA_WINDOW = 20;

export type MarketRegimeStatus = 'OPEN' | 'CLOSED' | 'UNKNOWN';

// UNKNOWN 은 게이트를 걸지 않는다(기존처럼 매수 진행) — 사유를 남겨 사후에 갈라 본다.
export type MarketRegimeReason =
  | 'ABOVE_MA'
  | 'AT_OR_BELOW_MA'
  | 'NO_AS_OF'
  | 'NO_CLOSE_ON_AS_OF'
  | 'INSUFFICIENT_HISTORY';

export interface BenchmarkCloseRow {
  // 'YYYY-MM-DD'
  tradeDate: string;
  close: number;
}

export interface MarketRegimeJudgement {
  status: MarketRegimeStatus;
  reason: MarketRegimeReason;
  // 판정 기준일(= 스크린 시세 기준일). null 이면 시세가 없어 판정하지 않았다.
  asOf: string | null;
  close: number | null;
  ma20: number | null;
  // MA20 계산에 쓴 종가 개수. 20 미만이면 UNKNOWN.
  closeCount: number;
  windowSize: number;
}

export const judgeMarketRegime = ({
  asOf,
  closes,
}: {
  asOf: string | null;
  closes: BenchmarkCloseRow[];
}): MarketRegimeJudgement => {
  const unknown = (
    reason: MarketRegimeReason,
    detail: Partial<MarketRegimeJudgement> = {},
  ): MarketRegimeJudgement => ({
    status: 'UNKNOWN',
    reason,
    asOf,
    close: null,
    ma20: null,
    closeCount: 0,
    windowSize: MARKET_REGIME_MA_WINDOW,
    ...detail,
  });
  if (asOf === null) {
    return unknown('NO_AS_OF');
  }
  // 기준일 이하만, 최신 순으로 20개. 입력 순서에 기대지 않는다.
  const window = closes
    .filter((row) => row.tradeDate <= asOf)
    .sort((left, right) => (left.tradeDate < right.tradeDate ? 1 : -1))
    .slice(0, MARKET_REGIME_MA_WINDOW);
  // 기준일 당일 종가가 없으면 지수 수집이 낡은 것이다 — 어제 지수로 오늘을 판정하지 않는다.
  if (window[0]?.tradeDate !== asOf) {
    return unknown('NO_CLOSE_ON_AS_OF', { closeCount: window.length });
  }
  if (window.length < MARKET_REGIME_MA_WINDOW) {
    return unknown('INSUFFICIENT_HISTORY', {
      close: window[0].close,
      closeCount: window.length,
    });
  }
  const ma20 =
    window.reduce((sum, row) => sum + row.close, 0) / MARKET_REGIME_MA_WINDOW;
  const close = window[0].close;
  const closed = close <= ma20;
  return {
    status: closed ? 'CLOSED' : 'OPEN',
    reason: closed ? 'AT_OR_BELOW_MA' : 'ABOVE_MA',
    asOf,
    close,
    ma20,
    closeCount: window.length,
    windowSize: MARKET_REGIME_MA_WINDOW,
  };
};
