import { DailyBar } from '../market-data.type';

export const MARKET_DATA_PORT = Symbol('MARKET_DATA_PORT');

export interface MarketDataPort {
  // 최근 days 개의 일봉. 휴장일은 애초에 반환되지 않는다.
  fetchDailyBars(symbol: string, days: number): Promise<DailyBar[]>;

  // 표시용 환율이므로 조회 실패는 null 로 폴백한다.
  fetchUsdKrwRate(): Promise<string | null>;
}
