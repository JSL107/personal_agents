import { DailySeriesPoint } from '../../market-data/domain/market-data.type';
import { IndicatorValues } from './indicator.type';

// ma120 은 120봉이면 되지만 return120 은 120거래일 전 봉이 더 필요하다.
export const MINIMUM_BAR_COUNT = 121;

const RETURN_SPANS = [20, 60, 120] as const;
const VOLATILITY_SPAN = 20;
const SURGE_RECENT_SPAN = 5;
const SURGE_BASE_SPAN = 60;
const TURNOVER_SPAN = 60;

const average = (values: number[]): number => {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const movingAverage = (closes: number[], span: number): number => {
  return average(closes.slice(-span));
};

const periodReturn = (closes: number[], span: number): number => {
  const base = closes[closes.length - 1 - span];
  return closes[closes.length - 1] / base - 1;
};

const standardDeviation = (values: number[]): number => {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

const dailyReturns = (closes: number[], span: number): number[] => {
  const window = closes.slice(-(span + 1));
  return window.slice(1).map((close, index) => close / window[index] - 1);
};

export const calculateIndicator = (
  bars: DailySeriesPoint[],
): IndicatorValues | null => {
  if (bars.length < MINIMUM_BAR_COUNT) {
    return null;
  }
  // 추세 지표는 조정가로 계산한다. 원본 종가로 계산하면 액면분할 당일에
  // 실제로는 없었던 급락이 수익률·이동평균에 그대로 박힌다.
  const adjCloses = bars.map((bar) => bar.adjClose);
  // 0 이하 가격은 공급자 오류다. 나눗셈이 Infinity 로 새는 것을 입구에서 막는다.
  if (adjCloses.some((adjClose) => adjClose <= 0)) {
    return null;
  }
  const volumes = bars.map((bar) => bar.volume);
  const lastBar = bars[bars.length - 1];
  const ma5 = movingAverage(adjCloses, 5);
  const ma20 = movingAverage(adjCloses, 20);
  const ma60 = movingAverage(adjCloses, 60);
  const ma120 = movingAverage(adjCloses, 120);
  const baseVolume = average(volumes.slice(-SURGE_BASE_SPAN));
  const [return20, return60, return120] = RETURN_SPANS.map((span) =>
    periodReturn(adjCloses, span),
  );

  return {
    lastTradeDate: lastBar.tradeDate,
    lastClose: lastBar.close,
    barCount: bars.length,
    ma5,
    ma20,
    ma60,
    ma120,
    isAligned: ma5 > ma20 && ma20 > ma60,
    isUptrend: ma60 > ma120,
    disparity20: lastBar.adjClose / ma20,
    volumeSurge:
      baseVolume === 0
        ? 0
        : average(volumes.slice(-SURGE_RECENT_SPAN)) / baseVolume,
    return20,
    return60,
    return120,
    high200Position: lastBar.adjClose / Math.max(...adjCloses),
    volatility20: standardDeviation(dailyReturns(adjCloses, VOLATILITY_SPAN)),
    // 유동성 판정은 실제로 거래된 금액을 물으므로 원본 종가로 잰다.
    turnover60: average(
      bars.slice(-TURNOVER_SPAN).map((bar) => bar.close * bar.volume),
    ),
  };
};
