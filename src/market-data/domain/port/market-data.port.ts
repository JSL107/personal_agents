import { DailyBar } from '../market-data.type';

export const MARKET_DATA_PORT = Symbol('MARKET_DATA_PORT');

export interface FetchDailyBarsOptions {
  // false 면 배당·분할이 반영되지 않은 실제 거래 가격. 모의투자 장부·체결이 이것을 쓴다.
  // 생략 시 true — 기존 주가 감시 호출자의 동작을 바꾸지 않는다.
  adjusted?: boolean;
  // 이 시각 이전 봉만 받는다(페이지네이션 커서). 직전 응답의 가장 오래된 봉의
  // timestamp 를 그대로 넘긴다 — 날짜만 담은 문자열은 공급자가 빈 응답으로 거부한다.
  before?: string;
}

export interface MarketDataPort {
  // 최근 days 개의 일봉. 휴장일은 애초에 반환되지 않는다.
  fetchDailyBars(
    symbol: string,
    days: number,
    options?: FetchDailyBarsOptions,
  ): Promise<DailyBar[]>;

  // 표시용 환율이므로 조회 실패는 null 로 폴백한다.
  fetchUsdKrwRate(): Promise<string | null>;
}
