import { MoneyValue } from '../../market-data/domain/market-data.type';

// 재는 지평. 5거래일은 SWING 의 호흡이고 20거래일은 한 달 남짓이다.
// 계좌를 연 지 얼마 안 된 구간에서는 5일치만 채워지고 20일치는 행 자체가 생기지 않는다.
export const SCREENING_OUTCOME_HORIZONS = [5, 20] as const;

export interface ScreeningOutcomeBar {
  tradeDate: Date;
  // daily_price.open 은 nullable 이다. 시가가 없으면 진입가를 지어낼 수 없어 건너뛴다.
  open: MoneyValue | null;
  close: MoneyValue;
}

export interface ScreeningOutcome {
  horizonDays: number;
  entryTradeDate: Date;
  entryPrice: string;
  horizonTradeDate: Date;
  horizonPrice: string;
  returnPct: string;
}

// 건너뛴 이유를 남긴다. "아직 안 왔다" 와 "값이 빠졌다" 를 한 기호로 묶으면 읽는 쪽이
// 대기를 고장으로 오해한다 — 채점 원장에서 실제로 겪은 문제다.
export type ScreeningOutcomeSkipReason =
  | 'NOT_DUE'
  | 'ENTRY_OPEN_MISSING'
  | 'ENTRY_PRICE_NOT_POSITIVE';

export type ScoreScreeningItemResult =
  | { kind: 'SCORED'; outcome: ScreeningOutcome }
  | { kind: 'SKIPPED'; reason: ScreeningOutcomeSkipReason };

export interface ScoreScreeningItemInput {
  horizonDays: number;
  // 회차 기준일 다음 거래일부터 오름차순. 달력이 아니라 저장된 봉으로 세야 휴장일과
  // 수집이 빈 날에 종목마다 다른 날을 비교하는 일이 생기지 않는다.
  barsAfterAsOf: ScreeningOutcomeBar[];
}

// 진입은 기준일 다음 거래일 시가, 청산은 진입일로부터 horizonDays 번째 거래일 종가다.
// 실제 매수도 다음 거래일 시가에 체결되므로 산 종목과 안 산 종목이 같은 출발선에 선다.
export const scoreScreeningItem = ({
  horizonDays,
  barsAfterAsOf,
}: ScoreScreeningItemInput): ScoreScreeningItemResult => {
  const entryBar = barsAfterAsOf[0];
  const horizonBar = barsAfterAsOf[horizonDays];
  if (!entryBar || !horizonBar) {
    return { kind: 'SKIPPED', reason: 'NOT_DUE' };
  }
  if (entryBar.open === null) {
    return { kind: 'SKIPPED', reason: 'ENTRY_OPEN_MISSING' };
  }
  if (entryBar.open.comparedTo(0) <= 0) {
    return { kind: 'SKIPPED', reason: 'ENTRY_PRICE_NOT_POSITIVE' };
  }

  const entryPrice = entryBar.open;
  const returnPct = horizonBar.close
    .minus(entryPrice)
    .dividedBy(entryPrice)
    .times(100);

  return {
    kind: 'SCORED',
    outcome: {
      horizonDays,
      entryTradeDate: entryBar.tradeDate,
      entryPrice: entryPrice.toString(),
      horizonTradeDate: horizonBar.tradeDate,
      horizonPrice: horizonBar.close.toString(),
      returnPct: returnPct.toString(),
    },
  };
};
