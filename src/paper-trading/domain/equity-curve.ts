// 계좌 수익률 곡선과 지수를 한 축에 놓기 위한 계산. 렌더(SVG)는 하지 않는다 —
// 좌표로 바꾸기 전의 판단(무엇을 그릴 수 있나, 축 범위가 얼마인가)만 여기서 한다.

export type CurveLineKind = 'ACCOUNT' | 'BENCHMARK';

export interface CurvePoint {
  tradeDate: string;
  valuePercent: number;
}

export interface CurveLine {
  label: string;
  kind: CurveLineKind;
  points: CurvePoint[];
}

export interface EquityCurveInput {
  series: Array<{
    accountName: string;
    points: Array<{ tradeDate: Date; returnRatePercent: number }>;
  }>;
  benchmark: Array<{ tradeDate: Date; close: number }>;
  benchmarkLabel: string;
}

export interface EquityCurveChart {
  lines: CurveLine[];
  minPercent: number;
  maxPercent: number;
  firstTradeDate: string | null;
  lastTradeDate: string | null;
  // 지수 선을 못 그린 이유. null 이면 그렸다. 문구로 남기는 이유는 빈 차트와
  // "지수 데이터가 없어서 계좌만 그린 차트" 를 읽는 사람이 구분해야 하기 때문이다.
  benchmarkOmittedReason: string | null;
}

// 선이 축에 딱 붙으면 꺾이는 지점이 잘려 보인다. 값의 폭에 비례해 띄우되, 폭이 0 에
// 가까운 구간(개설 직후)에서도 납작해지지 않게 하한을 둔다.
const AXIS_PADDING_RATIO = 0.12;
const MINIMUM_AXIS_SPAN_PERCENT = 4;

const dateTextOf = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * 지수 종가를 "기준일 대비 변화율(%)" 로 바꾼다. 계좌 수익률과 같은 축에 놓으려면
 * 단위가 같아야 하고, 기준일은 계좌 곡선이 시작한 날이어야 한다 — 다른 날을 기준으로
 * 삼으면 두 선의 출발점이 어긋나 "지수를 이겼나" 를 눈으로 읽을 수 없다.
 *
 * 기준일 당일 종가가 없으면 **그 이전의 가장 최근 종가**로 물러선다. 계좌 스냅샷은
 * 평가 cron 이 도는 날에만 쌓이고 지수는 거래일에만 쌓여, 두 날짜 집합이 항상 같지는 않다.
 * 이전 종가도 없으면 기준이 없으므로 지수 선을 그리지 않는다 — 없는 기준으로 정규화한
 * 선은 위아래로 아무 데나 놓인다.
 */
const toBenchmarkLine = (
  input: EquityCurveInput,
  baseTradeDate: string,
): { line: CurveLine | null; omittedReason: string | null } => {
  if (input.benchmark.length === 0) {
    return { line: null, omittedReason: '지수 종가가 조회되지 않았다' };
  }
  const sorted = [...input.benchmark]
    .map((point) => ({
      tradeDate: dateTextOf(point.tradeDate),
      close: point.close,
    }))
    .filter((point) => Number.isFinite(point.close) && point.close > 0)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const baseIndex = findBaseIndex(sorted, baseTradeDate);
  if (baseIndex === null) {
    return {
      line: null,
      omittedReason: `기준일 ${baseTradeDate} 이전의 지수 종가가 없다`,
    };
  }
  const baseClose = sorted[baseIndex].close;
  return {
    line: {
      label: input.benchmarkLabel,
      kind: 'BENCHMARK',
      points: sorted.slice(baseIndex).map((point) => ({
        tradeDate: point.tradeDate,
        valuePercent: (point.close / baseClose - 1) * 100,
      })),
    },
    omittedReason: null,
  };
};

const findBaseIndex = (
  sorted: Array<{ tradeDate: string; close: number }>,
  baseTradeDate: string,
): number | null => {
  let candidate: number | null = null;
  for (const [index, point] of sorted.entries()) {
    if (point.tradeDate <= baseTradeDate) {
      candidate = index;
      continue;
    }
    break;
  }
  return candidate;
};

export const buildEquityCurveChart = (
  input: EquityCurveInput,
): EquityCurveChart => {
  const accountLines: CurveLine[] = input.series
    .filter((entry) => entry.points.length > 0)
    .map((entry) => ({
      label: entry.accountName,
      kind: 'ACCOUNT' as const,
      points: entry.points
        .filter((point) => Number.isFinite(point.returnRatePercent))
        .map((point) => ({
          tradeDate: dateTextOf(point.tradeDate),
          valuePercent: point.returnRatePercent,
        }))
        .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate)),
    }))
    .filter((line) => line.points.length > 0);

  if (accountLines.length === 0) {
    return {
      lines: [],
      minPercent: 0,
      maxPercent: 0,
      firstTradeDate: null,
      lastTradeDate: null,
      benchmarkOmittedReason: '계좌 평가 스냅샷이 없다',
    };
  }

  const accountDates = accountLines.flatMap((line) =>
    line.points.map((point) => point.tradeDate),
  );
  const baseTradeDate = accountDates.reduce((earliest, date) =>
    date < earliest ? date : earliest,
  );
  const benchmark = toBenchmarkLine(input, baseTradeDate);
  // 지수는 계좌 곡선이 끝난 날까지만 그린다. 계좌 스냅샷보다 최신 종가가 있으면
  // 지수 선만 오른쪽으로 더 뻗어, 같은 기간을 비교한 그림이 아니게 된다.
  const lastAccountDate = accountDates.reduce((latest, date) =>
    date > latest ? date : latest,
  );
  const benchmarkLine =
    benchmark.line === null
      ? null
      : {
          ...benchmark.line,
          points: benchmark.line.points.filter(
            (point) => point.tradeDate <= lastAccountDate,
          ),
        };

  const lines = [...accountLines, ...(benchmarkLine ? [benchmarkLine] : [])];
  const values = lines.flatMap((line) =>
    line.points.map((point) => point.valuePercent),
  );
  const rawMinimum = Math.min(...values, 0);
  const rawMaximum = Math.max(...values, 0);
  const padding = Math.max(
    (rawMaximum - rawMinimum) * AXIS_PADDING_RATIO,
    MINIMUM_AXIS_SPAN_PERCENT / 2,
  );

  return {
    lines,
    minPercent: rawMinimum - padding,
    maxPercent: rawMaximum + padding,
    firstTradeDate: baseTradeDate,
    lastTradeDate: lastAccountDate,
    benchmarkOmittedReason: benchmark.omittedReason,
  };
};

/**
 * 곡선의 마지막 값. 카드 옆에 적는 숫자라 곡선과 같은 출처를 써야 한다 —
 * 평가 스냅샷을 따로 읽어 적으면 그림과 글의 숫자가 갈린다.
 */
export const lastValueOf = (line: CurveLine): number | null =>
  line.points.at(-1)?.valuePercent ?? null;
