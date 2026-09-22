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
  // 공통 기준일보다 먼저 시작해 앞부분이 잘린 계좌 이름. 잘랐다는 사실을 안 적으면
  // 그 계좌의 성적이 실제보다 짧은 구간의 것으로 읽힌다.
  truncatedAccounts: string[];
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

// 누적 수익률을 기준 시점 대비로 되맞춘다. 두 시점의 시드 대비 배수를 나누는 것이라
// `r_t - r_0` 가 아니다 — 차를 쓰면 기준값이 클 때 어긋난다(+50% → +60% 는 +10%p 가
// 아니라 +6.7%).
const rebase = (points: CurvePoint[], basePercent: number): CurvePoint[] => {
  const baseMultiple = 1 + basePercent / 100;
  return points.map((point) => ({
    tradeDate: point.tradeDate,
    valuePercent: ((1 + point.valuePercent / 100) / baseMultiple - 1) * 100,
  }));
};

// 기준 시점에 시드를 전부 잃은 계좌(-100%)는 배수가 0 이라 나눌 수 없다. 그 계좌를
// 0 으로 나눈 Infinity 로 그리면 축이 통째로 무너지므로 곡선에서 뺀다.
const isRebaseable = (basePercent: number): boolean =>
  Number.isFinite(basePercent) && 1 + basePercent / 100 !== 0;

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
      truncatedAccounts: [],
    };
  }

  // 기준일은 **모든 계좌가 데이터를 갖는 가장 늦은 시작일** 이다. 가장 이른 날로 잡으면
  // 늦게 열린 계좌는 지수와 출발점이 어긋나고, 지수 선은 하나뿐이라 두 계좌에 동시에
  // 맞출 수가 없다. 비교 그림이므로 공통 구간을 비교한다 — 잘린 구간은 아래에서 적는다.
  const baseTradeDate = accountLines
    .map((line) => line.points[0].tradeDate)
    .reduce((latest, date) => (date > latest ? date : latest));
  const truncated = accountLines
    .filter((line) => line.points[0].tradeDate < baseTradeDate)
    .map((line) => line.label);
  const benchmark = toBenchmarkLine(input, baseTradeDate);
  // 기준일부터 자르고 그 날을 0% 로 맞춘다. 계좌 수익률(`return_rate`)은 시드 대비
  // **누적**이라 기준일 값이 0 이 아니다(실측 2026-09-22: 개설 다음 날 LONG_TERM +1.14% ·
  // SWING +2.70%). 그대로 그리면 0% 에서 출발하는 지수 선과 출발점이 어긋나, 두 선의
  // 간격이 "이 기간의 성적 차이" 가 아니라 "그 차이 + 시작 시점의 차이" 가 된다.
  // 리포트 창이 이력을 자르기 시작하면 그 어긋남이 창 밖 손익만큼 커진다.
  //
  // 시드 대비 누적은 텍스트 카드가 이미 적는다 — 이 그림의 질문은 "이 기간에 누가 더
  // 벌었나" 이므로 기간 수익률로 맞추는 것이 맞다.
  const rebasedAccountLines = accountLines.flatMap((line) => {
    const points = line.points.filter(
      (point) => point.tradeDate >= baseTradeDate,
    );
    const basePercent = points[0]?.valuePercent;
    if (basePercent === undefined || !isRebaseable(basePercent)) {
      return [];
    }
    return [{ ...line, points: rebase(points, basePercent) }];
  });
  if (rebasedAccountLines.length === 0) {
    return {
      lines: [],
      minPercent: 0,
      maxPercent: 0,
      firstTradeDate: null,
      lastTradeDate: null,
      benchmarkOmittedReason: '기준일 수익률로 곡선을 맞출 수 없다',
      truncatedAccounts: [],
    };
  }
  // 지수는 계좌 곡선이 끝난 날까지만 그린다. 계좌 스냅샷보다 최신 종가가 있으면
  // 지수 선만 오른쪽으로 더 뻗어, 같은 기간을 비교한 그림이 아니게 된다.
  const lastAccountDate = rebasedAccountLines
    .flatMap((line) => line.points.map((point) => point.tradeDate))
    .reduce((latest, date) => (date > latest ? date : latest));
  const benchmarkLine =
    benchmark.line === null
      ? null
      : {
          ...benchmark.line,
          points: benchmark.line.points.filter(
            (point) => point.tradeDate <= lastAccountDate,
          ),
        };

  const lines = [
    ...rebasedAccountLines,
    ...(benchmarkLine ? [benchmarkLine] : []),
  ];
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
    truncatedAccounts: truncated,
  };
};

/**
 * 곡선의 마지막 값. 카드 옆에 적는 숫자라 곡선과 같은 출처를 써야 한다 —
 * 평가 스냅샷을 따로 읽어 적으면 그림과 글의 숫자가 갈린다.
 */
export const lastValueOf = (line: CurveLine): number | null =>
  line.points.at(-1)?.valuePercent ?? null;
