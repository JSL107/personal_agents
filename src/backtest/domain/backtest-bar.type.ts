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
  // 상장폐지일. null 이면 아직 상장 중이다. 재생은 이 날짜를 지난 종목을 후보로 올리지
  // 않고, 그날 보유 중이면 청산한다 — 폐지를 모르면 마지막 종가로 영원히 들고 있게 된다.
  delistedAt: Date | null;
}
