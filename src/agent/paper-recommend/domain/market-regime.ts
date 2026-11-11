import { ConstrainedPaperRecommendation } from './paper-recommendation.type';

// SWING 신규 매수 보류 게이트. KOSPI 종가가 20일 이동평균 이하인 날의 SWING 후보는
// 5거래일 평균 -6.1%(위인 날 -0.7%)였다. 효과는 아직 미검증이라 판정 근거를 전량 남긴다.
export const MARKET_REGIME_MA_WINDOW = 20;

export enum MarketRegimeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  // 판정할 수 없어 게이트를 걸지 않는다(기존처럼 매수 진행).
  UNKNOWN = 'UNKNOWN',
}

// UNKNOWN 으로 판정한 사유. OPEN·CLOSED 는 상태 자체가 사유라 따로 남기지 않는다.
export enum MarketRegimeUnknownReason {
  NO_DATA_AS_OF = 'NO_DATA_AS_OF',
  NO_CLOSE_ON_DATA_AS_OF = 'NO_CLOSE_ON_DATA_AS_OF',
  INSUFFICIENT_HISTORY = 'INSUFFICIENT_HISTORY',
}

export interface BenchmarkCloseRow {
  // 'YYYY-MM-DD'
  tradeDate: string;
  close: number;
}

export interface MarketRegimeJudgement {
  status: MarketRegimeStatus;
  unknownReason: MarketRegimeUnknownReason | null;
  // 판정 기준일(= 스크린 시세 기준일). null 이면 시세가 없어 판정하지 않았다.
  dataAsOf: string | null;
  close: number | null;
  ma20: number | null;
  // MA20 계산에 쓴 종가 개수. 20 미만이면 UNKNOWN.
  closeCount: number;
  windowSize: number;
}

export const judgeMarketRegime = ({
  dataAsOf,
  closes,
}: {
  dataAsOf: string | null;
  closes: BenchmarkCloseRow[];
}): MarketRegimeJudgement => {
  const unknown = ({
    reason,
    close = null,
    closeCount = 0,
  }: {
    reason: MarketRegimeUnknownReason;
    close?: number | null;
    closeCount?: number;
  }): MarketRegimeJudgement => ({
    status: MarketRegimeStatus.UNKNOWN,
    unknownReason: reason,
    dataAsOf,
    close,
    ma20: null,
    closeCount,
    windowSize: MARKET_REGIME_MA_WINDOW,
  });
  if (dataAsOf === null) {
    return unknown({ reason: MarketRegimeUnknownReason.NO_DATA_AS_OF });
  }
  // 기준일 이하만, 최신 순으로 20개. 입력 순서에 기대지 않는다.
  const window = closes
    .filter((row) => row.tradeDate <= dataAsOf)
    .sort((left, right) => (left.tradeDate < right.tradeDate ? 1 : -1))
    .slice(0, MARKET_REGIME_MA_WINDOW);
  // 기준일 당일 종가가 없으면 지수 수집이 낡은 것이다 — 어제 지수로 오늘을 판정하지 않는다.
  if (window[0]?.tradeDate !== dataAsOf) {
    return unknown({
      reason: MarketRegimeUnknownReason.NO_CLOSE_ON_DATA_AS_OF,
      closeCount: window.length,
    });
  }
  const close = window[0].close;
  if (window.length < MARKET_REGIME_MA_WINDOW) {
    return unknown({
      reason: MarketRegimeUnknownReason.INSUFFICIENT_HISTORY,
      close,
      closeCount: window.length,
    });
  }
  const ma20 =
    window.reduce((sum, row) => sum + row.close, 0) / MARKET_REGIME_MA_WINDOW;
  const status =
    close <= ma20 ? MarketRegimeStatus.CLOSED : MarketRegimeStatus.OPEN;
  return {
    status,
    unknownReason: null,
    dataAsOf,
    close,
    ma20,
    closeCount: window.length,
    windowSize: MARKET_REGIME_MA_WINDOW,
  };
};

// 국면 보류: 제약을 평소대로 통과한 매수만 주문에서 빼고 보류 사유로 옮긴다. 제약 앞에서 제안
// 전부를 빼면 어차피 못 샀을 제안(이미 보유·후보 밖·건수 상한·현금 부족)까지 보류 채점 표본에
// 섞여 "안 사길 잘했나" 가 흐려진다. 그 제안들은 원래 사유로 남고, 매도는 그대로다.
export const holdBuysForMarketRegime = (
  constrained: ConstrainedPaperRecommendation,
): ConstrainedPaperRecommendation => ({
  ...constrained,
  buys: [],
  skipped: [
    ...constrained.skipped,
    ...constrained.buys.map((buy) => ({
      side: 'BUY' as const,
      code: buy.code,
      reason: 'MARKET_REGIME_GATE' as const,
    })),
  ],
});
