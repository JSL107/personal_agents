import { DecimalValue } from '../market-data.type';

export const MARKET_INDICATOR_PORT = Symbol('MARKET_INDICATOR_PORT');

export interface BenchmarkBar {
  tradeDate: Date;
  close: DecimalValue;
}

// 기존 MARKET_DATA_PORT 확장은 모든 종목 시세 mock을 깨고, 시장지표는 종목과 응답 계약도 다르므로 별도 포트로 둔다.
export interface MarketIndicatorPort {
  fetchDailyCloses(symbol: string, count: number): Promise<BenchmarkBar[]>;
}
