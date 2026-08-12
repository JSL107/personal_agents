import { DecimalValue } from './market-data.type';

const TRADING_DAYS_PER_YEAR = 252;
// 이름이 200일인데 짧은 구간 값을 섞으면 고점 표본이 낮아 신규·부분 이력 종목이 부당하게 유리해진다.
const HIGH_POSITION_MINIMUM_BARS = 200;
const TURNOVER_LOOKBACK_BARS = 60;

export interface IndicatorBar {
  tradeDate: Date;
  close: DecimalValue;
  adjClose: DecimalValue;
  volume: bigint;
}

export interface StockIndicators {
  close: number;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  isAligned: boolean | null;
  volumeSurge: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  // 저장 일봉에 장중 고가가 없어 최근 200봉의 최고 종가 기준이다. 장중에 찍고 내려온 고점은 반영하지 못한다.
  high200Position: number | null;
  volatility20: number | null;
  turnover60: number | null;
  barCount: number;
}

const averageLast = (values: number[], count: number): number | null => {
  if (values.length < count) {
    return null;
  }
  const selected = values.slice(-count);
  return selected.reduce((sum, value) => sum + value, 0) / count;
};

const calculateReturn = (closes: number[], lookback: number): number | null => {
  if (closes.length <= lookback) {
    return null;
  }
  const previous = closes[closes.length - 1 - lookback];
  if (previous === 0) {
    return null;
  }
  return (closes[closes.length - 1] / previous - 1) * 100;
};

const calculateVolumeSurge = (bars: IndicatorBar[]): number | null => {
  if (bars.length <= 20) {
    return null;
  }
  const previousVolumes = bars.slice(-21, -1).map((bar) => Number(bar.volume));
  const average =
    previousVolumes.reduce((sum, volume) => sum + volume, 0) /
    previousVolumes.length;
  if (average === 0) {
    return null;
  }
  return Number(bars[bars.length - 1].volume) / average;
};

const calculateTurnover60 = (bars: IndicatorBar[]): number | null => {
  if (bars.length < TURNOVER_LOOKBACK_BARS) {
    return null;
  }
  const selected = bars.slice(-TURNOVER_LOOKBACK_BARS);
  return (
    selected.reduce(
      (sum, bar) => sum + bar.close.toNumber() * Number(bar.volume),
      0,
    ) / TURNOVER_LOOKBACK_BARS
  );
};

const calculateVolatility20 = (closes: number[]): number | null => {
  if (closes.length <= 20) {
    return null;
  }
  const selected = closes.slice(-21);
  const returns: number[] = [];
  for (let index = 1; index < selected.length; index += 1) {
    if (selected[index - 1] === 0) {
      return null;
    }
    returns.push(selected[index] / selected[index - 1] - 1);
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
};

export const calculateIndicators = (
  bars: IndicatorBar[],
): StockIndicators | null => {
  if (bars.length === 0) {
    return null;
  }

  // 외부 조정 계열만 숫자로 좁혀 배당락·분할을 가격 추세로 오인하지 않는다.
  const closes = bars.map((bar) => bar.adjClose.toNumber());
  const close = closes[closes.length - 1];
  const ma5 = averageLast(closes, 5);
  const ma20 = averageLast(closes, 20);
  const ma60 = averageLast(closes, 60);
  const ma120 = averageLast(closes, 120);
  const isAligned =
    ma5 === null || ma20 === null || ma60 === null || ma120 === null
      ? null
      : ma5 > ma20 && ma20 > ma60 && ma60 > ma120;
  // 공용 함수 호출자가 더 긴 이력을 넘겨도 이름대로 마지막 200거래일만 본다.
  // 저장 계층에 고가가 없으므로 장중 고점이 아니라 조정 종가의 최대값을 쓴다.
  const highest = Math.max(...closes.slice(-200));

  return {
    close,
    ma5,
    ma20,
    ma60,
    ma120,
    isAligned,
    volumeSurge: calculateVolumeSurge(bars),
    return1m: calculateReturn(closes, 20),
    return3m: calculateReturn(closes, 60),
    return6m: calculateReturn(closes, 120),
    high200Position:
      bars.length < HIGH_POSITION_MINIMUM_BARS || highest === 0
        ? null
        : close / highest,
    volatility20: calculateVolatility20(closes),
    // 거래대금은 그날 실제 체결 금액이므로 원본 종가를 쓴다. 현재 수집은 adjusted=true이고
    // 토스 매퍼가 close·adjClose에 같은 값을 넣어 저장하지만, 최근 60봉 실측은 차이가 없었다.
    // 수집이 미조정 계열로 바뀌면 이 계산은 별도 변경 없이 원본 종가를 사용하게 된다.
    turnover60: calculateTurnover60(bars),
    barCount: bars.length,
  };
};
