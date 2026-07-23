import { DailyBar, ResolvedInstrument } from '../market-data.type';

export const MARKET_DATA_PORT = Symbol('MARKET_DATA_PORT');

export interface MarketDataPort {
  // 심볼이 실재하고 응답이 오염되지 않았을 때만 종목 정보를 돌려준다.
  // 미존재·오염 응답은 예외가 아니라 null 이다(호출부가 등록을 중단하도록).
  resolveSymbol(yahooSymbol: string): Promise<ResolvedInstrument | null>;

  // 최근 거래일부터 역순으로 days 개의 일봉. 휴장일은 애초에 반환되지 않는다.
  fetchDailyBars(yahooSymbol: string, days: number): Promise<DailyBar[]>;

  // Yahoo KRW=X 현재가. 표시용 환율이므로 조회 실패는 null 로 폴백한다.
  fetchUsdKrwRate(): Promise<string | null>;
}
