import {
  CurveLine,
  EquityCurveChart,
  lastValueOf,
} from '../domain/equity-curve';

// 슬랙 카드에 그대로 뜨는 폭. 더 넓히면 카드가 줄여서 보여주고, 더 좁히면 x축 날짜가 겹친다.
//
// 렌더 폭과 같은 값이어야 한다 — 렌더가 더 좁으면 HTML 이 그 폭에 맞춰 줄어들며 SVG
// 오른쪽(끝 라벨)이 잘린다. 그래서 내보내고, 렌더를 부르는 쪽이 이 값을 읽어 쓴다.
export const PAPER_REPORT_WIDTH_PX = 720;
const CANVAS_WIDTH = PAPER_REPORT_WIDTH_PX;
const PLOT_HEIGHT = 260;
const PADDING = { top: 16, right: 132, bottom: 26, left: 48 };

// 색은 dataviz 팔레트의 categorical 슬롯 1·2 를 라이트 서피스에서 그대로 쓴다.
// 검증 결과(scripts/validate_palette.js --mode light): 인접 쌍 CVD ΔE 24.7 (목표 8 이상),
// 정상시야 ΔE 33.6 (하한 15), 서피스 대비 3:1 이상 — 전 항목 통과.
// PNG 한 장으로 나가므로 다크 스텝은 쓰지 않는다(뷰어 테마를 알 수 없다).
const SURFACE = '#fcfcfb';
const TEXT_PRIMARY = '#0b0b0b';
const TEXT_SECONDARY = '#52514e';
const GRID = '#e5e5e1';
const ZERO_RULE = '#b8b7b0';
const ACCOUNT_COLORS = ['#2a78d6', '#eb6834'];
// 벤치마크는 비교 기준이라 계좌 곡선보다 물러서 있어야 한다. 채도를 뺀 회색이라
// 색각 이상에서도 두 계좌 색과 섞이지 않고, 점선이 그 구분을 한 번 더 받친다.
const BENCHMARK_COLOR = '#8a8880';

const ACCOUNT_LABELS: Record<string, string> = {
  LONG_TERM: '장기투자',
  SWING: '단기매매',
};

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const labelOf = (line: CurveLine): string =>
  line.kind === 'BENCHMARK'
    ? line.label
    : (ACCOUNT_LABELS[line.label] ?? line.label);

const colorOf = (line: CurveLine, accountIndex: number): string =>
  line.kind === 'BENCHMARK'
    ? BENCHMARK_COLOR
    : (ACCOUNT_COLORS[accountIndex] ?? ACCOUNT_COLORS[0]);

const formatPercent = (value: number): string =>
  `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

const formatMonthDay = (tradeDate: string): string =>
  `${Number(tradeDate.slice(5, 7))}/${Number(tradeDate.slice(8, 10))}`;

interface PlotGeometry {
  xOf: (tradeDate: string) => number;
  yOf: (valuePercent: number) => number;
}

// x 는 날짜의 **순서**가 아니라 실제 달력 간격으로 놓는다. 순서로 놓으면 스냅샷이 빠진
// 날(평가 cron 실패)이 없는 것처럼 압축돼, 이후 구간의 기울기가 실제보다 완만해진다.
const buildGeometry = (chart: EquityCurveChart): PlotGeometry => {
  const plotWidth = CANVAS_WIDTH - PADDING.left - PADDING.right;
  const firstTime = Date.parse(`${chart.firstTradeDate}T00:00:00.000Z`);
  const lastTime = Date.parse(`${chart.lastTradeDate}T00:00:00.000Z`);
  const timeSpan = Math.max(1, lastTime - firstTime);
  const valueSpan = Math.max(0.0001, chart.maxPercent - chart.minPercent);
  return {
    xOf: (tradeDate) => {
      const time = Date.parse(`${tradeDate}T00:00:00.000Z`);
      return PADDING.left + ((time - firstTime) / timeSpan) * plotWidth;
    },
    yOf: (valuePercent) =>
      PADDING.top +
      ((chart.maxPercent - valuePercent) / valueSpan) * PLOT_HEIGHT,
  };
};

// y축 눈금. 값 범위를 덮는 "깔끔한 수" 간격을 고른다 — 1·2·5·10·20·50… 중 눈금이 4~6개
// 나오는 첫 값이다. 범위에 비례한 임의 간격을 쓰면 -18.84 구간에서 -3.77 같은 눈금이 나온다.
const niceTicks = (minimum: number, maximum: number): number[] => {
  const span = maximum - minimum;
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100];
  const step =
    candidates.find((value) => span / value <= 6) ??
    candidates[candidates.length - 1];
  const ticks: number[] = [];
  for (
    let tick = Math.ceil(minimum / step) * step;
    tick <= maximum;
    tick += step
  ) {
    ticks.push(tick);
  }
  return ticks;
};

// 선 끝 라벨은 y값 순으로 세우고 최소 간격을 강제한다. 두 계좌 성적이 비슷한 날에는
// 라벨이 같은 높이에 겹쳐, 어느 선의 값인지 읽을 수 없게 된다.
const LABEL_MINIMUM_GAP_PX = 16;

interface EndLabel {
  y: number;
  text: string;
  color: string;
}

const layoutEndLabels = (
  entries: Array<{ y: number; text: string; color: string }>,
): EndLabel[] => {
  const sorted = [...entries].sort((left, right) => left.y - right.y);
  let previousY = -Infinity;
  return sorted.map((entry) => {
    const y = Math.max(entry.y, previousY + LABEL_MINIMUM_GAP_PX);
    previousY = y;
    return { ...entry, y, text: entry.text };
  });
};

// x축 날짜. 양 끝만 적으면 5주 구간에서 중간 어느 시점인지 읽을 수 없어, 그 사이를
// 균등 간격으로 채운다. 눈금 날짜는 실제 거래일이 아니어도 된다 — 시간축의 위치 표시다.
const X_AXIS_TICK_TARGET = 5;

const xAxisDates = (
  chart: EquityCurveChart,
): Array<{ tradeDate: string; anchor: 'start' | 'middle' | 'end' }> => {
  if (chart.firstTradeDate === null || chart.lastTradeDate === null) {
    return [];
  }
  const firstTime = Date.parse(`${chart.firstTradeDate}T00:00:00.000Z`);
  const lastTime = Date.parse(`${chart.lastTradeDate}T00:00:00.000Z`);
  if (lastTime <= firstTime) {
    return [{ tradeDate: chart.firstTradeDate, anchor: 'start' }];
  }
  const step = (lastTime - firstTime) / (X_AXIS_TICK_TARGET - 1);
  return Array.from({ length: X_AXIS_TICK_TARGET }, (_unused, index) => {
    const time = firstTime + step * index;
    return {
      tradeDate: new Date(time).toISOString().slice(0, 10),
      // 양 끝 라벨은 플롯 밖으로 나가지 않게 안쪽으로 붙인다.
      anchor:
        index === 0
          ? ('start' as const)
          : index === X_AXIS_TICK_TARGET - 1
            ? ('end' as const)
            : ('middle' as const),
    };
  });
};

const polylineOf = (line: CurveLine, geometry: PlotGeometry): string =>
  line.points
    .map(
      (point) =>
        `${geometry.xOf(point.tradeDate).toFixed(1)},${geometry.yOf(point.valuePercent).toFixed(1)}`,
    )
    .join(' ');

const renderChartSvg = (chart: EquityCurveChart): string => {
  const geometry = buildGeometry(chart);
  const svgHeight = PADDING.top + PLOT_HEIGHT + PADDING.bottom;
  const plotRight = CANVAS_WIDTH - PADDING.right;
  const ticks = niceTicks(chart.minPercent, chart.maxPercent);

  // 격자·축은 서피스에서 한 단계 off 한 1px 실선이다(점선은 "임계값" 으로 읽힌다).
  const gridLines = ticks
    .map((tick) => {
      const y = geometry.yOf(tick).toFixed(1);
      const isZero = tick === 0;
      return (
        `<line x1="${PADDING.left}" y1="${y}" x2="${plotRight}" y2="${y}" ` +
        `stroke="${isZero ? ZERO_RULE : GRID}" stroke-width="1"/>` +
        `<text x="${PADDING.left - 8}" y="${y}" fill="${TEXT_SECONDARY}" font-size="11" ` +
        `text-anchor="end" dominant-baseline="middle">${formatPercent(tick)}</text>`
      );
    })
    .join('');

  const xTicks = xAxisDates(chart)
    .map(({ tradeDate, anchor }) => {
      const x = geometry.xOf(tradeDate);
      return (
        `<text x="${x.toFixed(1)}" y="${(PADDING.top + PLOT_HEIGHT + 17).toFixed(1)}" ` +
        `fill="${TEXT_SECONDARY}" font-size="11" text-anchor="${anchor}">` +
        `${formatMonthDay(tradeDate)}</text>`
      );
    })
    .join('');

  let accountIndex = 0;
  const drawn = chart.lines.map((line) => {
    const color = colorOf(line, accountIndex);
    if (line.kind === 'ACCOUNT') {
      accountIndex += 1;
    }
    return { line, color };
  });

  // 벤치마크를 먼저 깔아 계좌 곡선이 그 위에 오게 한다. 이 그림의 주인공은 계좌다.
  const ordered = [
    ...drawn.filter((entry) => entry.line.kind === 'BENCHMARK'),
    ...drawn.filter((entry) => entry.line.kind === 'ACCOUNT'),
  ];

  const paths = ordered
    .map(
      ({ line, color }) =>
        `<polyline fill="none" stroke="${color}" stroke-width="2" ` +
        `stroke-linejoin="round" stroke-linecap="round"` +
        `${line.kind === 'BENCHMARK' ? ' stroke-dasharray="5 4"' : ''} ` +
        `points="${polylineOf(line, geometry)}"/>`,
    )
    .join('');

  // 끝점 마커는 지름 8px(r=4) 이고 서피스 색 2px 링을 두른다 — 선이 겹치는 지점에서
  // 어느 곡선의 끝인지 구분된다.
  const markers = ordered
    .map(({ line, color }) => {
      const last = line.points.at(-1);
      if (!last) {
        return '';
      }
      return (
        `<circle cx="${geometry.xOf(last.tradeDate).toFixed(1)}" ` +
        `cy="${geometry.yOf(last.valuePercent).toFixed(1)}" r="4" ` +
        `fill="${color}" stroke="${SURFACE}" stroke-width="2"/>`
      );
    })
    .join('');

  const endLabels = layoutEndLabels(
    ordered.flatMap(({ line, color }) => {
      const value = lastValueOf(line);
      if (value === null) {
        return [];
      }
      return [
        {
          y: geometry.yOf(value),
          text: `${labelOf(line)} ${formatPercent(value)}`,
          color,
        },
      ];
    }),
  )
    .map(
      (label) =>
        `<text x="${plotRight + 10}" y="${label.y.toFixed(1)}" fill="${TEXT_SECONDARY}" ` +
        `font-size="12" dominant-baseline="middle">` +
        `<tspan fill="${label.color}">●</tspan> ${escapeHtml(label.text)}</text>`,
    )
    .join('');

  return (
    `<svg width="${CANVAS_WIDTH}" height="${svgHeight}" viewBox="0 0 ${CANVAS_WIDTH} ${svgHeight}" ` +
    `xmlns="http://www.w3.org/2000/svg">` +
    `${gridLines}${xTicks}${paths}${markers}${endLabels}</svg>`
  );
};

export interface PaperReportHtmlInput {
  chart: EquityCurveChart;
  // 리포트 기준일. 차트의 마지막 날짜와 다를 수 있다 — 평가가 실패한 날은 곡선이
  // 그 전날에서 끝나므로, 둘을 같은 값으로 적으면 그림이 최신인 것처럼 읽힌다.
  asOf: string;
}

export const buildPaperReportHtml = ({
  chart,
  asOf,
}: PaperReportHtmlInput): string => {
  const range =
    chart.firstTradeDate === null || chart.lastTradeDate === null
      ? '기간 미정'
      : `${chart.firstTradeDate} ~ ${chart.lastTradeDate}`;
  // 지수 선이 빠진 이유를 그림 안에 적는다. 안 적으면 "지수보다 나았다" 를 읽을 수
  // 없는 그림인데도 계좌 곡선만 보고 판단하게 된다.
  const notices = [
    ...(chart.benchmarkOmittedReason === null
      ? []
      : [`지수 대비 없음 — ${chart.benchmarkOmittedReason}`]),
    ...(chart.truncatedAccounts.length === 0
      ? []
      : [
          `${chart.truncatedAccounts.join(' · ')} 는 더 이른 이력이 있으나 공통 시작일에 맞춰 잘렸다`,
        ]),
  ];
  const notice =
    notices.length === 0
      ? ''
      : `<p class="notice">${notices.map((text) => escapeHtml(text)).join('<br>')}</p>`;
  const legend = chart.lines
    .map((line, index) => {
      const accountIndex = chart.lines
        .slice(0, index)
        .filter((entry) => entry.kind === 'ACCOUNT').length;
      const color = colorOf(line, accountIndex);
      return (
        `<span class="legend-item"><span class="swatch" style="background:${color}"></span>` +
        `${escapeHtml(labelOf(line))}</span>`
      );
    })
    .join('');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>모의투자 수익률</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: ${CANVAS_WIDTH}px;
    background: ${SURFACE};
    color: ${TEXT_PRIMARY};
    /* 한글에 고정폭 서체를 쓰면 낱자 폭이 라틴 글자에 맞춰 늘어나 글자 사이가 벌어진다. */
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
      'Noto Sans KR', 'Malgun Gothic', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .report { padding: 20px 24px 10px; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 2px; letter-spacing: -0.2px; }
  .range { font-size: 12px; color: ${TEXT_SECONDARY}; margin: 0 0 4px; }
  .legend { display: flex; gap: 14px; margin: 6px 0 2px; font-size: 12px; color: ${TEXT_SECONDARY}; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .notice { font-size: 11px; color: ${TEXT_SECONDARY}; margin: 6px 0 0; }
  svg { display: block; margin-left: -4px; }
</style></head>
<body><div class="report">
  <h1>모의투자 수익률 — 기간 비교</h1>
  <p class="range">${escapeHtml(range)} · 시작일을 0%로 맞춘 기간 수익률 · 기준일 ${escapeHtml(asOf)}</p>
  <div class="legend">${legend}</div>
  ${renderChartSvg(chart)}
  ${notice}
</div></body></html>`;
};
