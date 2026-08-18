import { IndicatorBar } from '../../market-data/domain/stock-indicator';

// 지표 계산은 기존 IndicatorBar 를 그대로 쓰고, 체결에만 필요한 시가를 얹는다.
// 시가가 없는 거래일은 체결이 불가능하므로 재생 루프가 실패로 보고한다.
export interface BacktestBar extends IndicatorBar {
  open: number | null;
}

export interface BacktestTicker {
  tickerId: number;
  code: string;
  name: string;
  krxMarket: string;
}
