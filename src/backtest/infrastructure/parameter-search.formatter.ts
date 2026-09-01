import { ScreenStrategy } from '../../screener/domain/screener-rule';
import {
  evaluateWalkForward,
  SearchWindow,
  summarizeCombinations,
  WindowOutcome,
} from '../domain/parameter-search';

export interface SearchWindowSummary {
  window: SearchWindow;
  tradeDateCount: number;
  benchmarkReturnPercent: number | null;
  // 현행값 회차의 표본. 창이 판정에 쓸 만한 크기인지는 이 숫자로 읽는다.
  baselineFilledCount: number;
  baselineClosedCount: number;
}

export interface ParameterSearchReport {
  strategy: ScreenStrategy;
  // 전략 말고도 회차를 가르는 조건이 있으면 제목에 함께 적는다(예: 슬리피지 회차).
  // 없으면 제목이 전략 하나다 — 조건이 안 적힌 표는 어느 가정의 성적인지 알 수 없다.
  conditionLabel?: string;
  baselineLabel: string;
  windows: SearchWindowSummary[];
  outcomes: WindowOutcome[];
}

const signedPercent = (value: number | null, digits = 2): string =>
  value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

const plainNumber = (value: number | null, digits = 2): string =>
  value === null ? '—' : value.toFixed(digits);

const tableOf = (header: string[], rows: string[][]): string =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

const labelCell = (label: string, baselineLabel: string): string =>
  label === baselineLabel ? `**${label}** (현행)` : label;

const formatWindowTable = (windows: SearchWindowSummary[]): string =>
  tableOf(
    ['창', '기간', '거래일', '코스피', '현행 체결', '현행 종결'],
    windows.map((summary) => [
      String(summary.window.index),
      `${summary.window.from} ~ ${summary.window.to}`,
      String(summary.tradeDateCount),
      `${signedPercent(summary.benchmarkReturnPercent, 1)}%`,
      String(summary.baselineFilledCount),
      String(summary.baselineClosedCount),
    ]),
  );

const formatSummaryTable = (
  outcomes: WindowOutcome[],
  baselineLabel: string,
): string => {
  const summaries = summarizeCombinations({ outcomes, baselineLabel });
  return tableOf(
    [
      '조합',
      '순위평균',
      '순위중앙',
      '초과수익 평균',
      '최종수익 평균',
      '최악 최대손실',
      '현행 대비 승',
      '종결계',
    ],
    summaries.map((summary) => [
      labelCell(summary.label, baselineLabel),
      plainNumber(summary.meanRank),
      plainNumber(summary.medianRank, 1),
      `${signedPercent(summary.meanExcessReturnPercent)}%`,
      `${signedPercent(summary.meanFinalReturnPercent)}%`,
      `${signedPercent(summary.worstMaximumLossPercent)}%`,
      summary.label === baselineLabel
        ? '—'
        : `${summary.winCount}/${summary.comparableCount}`,
      String(summary.closedCountTotal),
    ]),
  );
};

const formatPerWindowTable = (
  outcomes: WindowOutcome[],
  windows: SearchWindowSummary[],
  baselineLabel: string,
): string => {
  const summaries = summarizeCombinations({ outcomes, baselineLabel });
  const byKey = new Map(
    outcomes.map((outcome) => [
      `${outcome.label} ${outcome.windowIndex}`,
      outcome,
    ]),
  );
  return tableOf(
    ['조합', ...windows.map((summary) => `창${summary.window.index}`)],
    summaries.map((summary) => [
      labelCell(summary.label, baselineLabel),
      ...windows.map((windowSummary) =>
        signedPercent(
          byKey.get(`${summary.label} ${windowSummary.window.index}`)
            ?.excessReturnPercent ?? null,
          1,
        ),
      ),
    ]),
  );
};

const formatWalkForward = (
  outcomes: WindowOutcome[],
  baselineLabel: string,
): string => {
  const verdicts = evaluateWalkForward({ outcomes, baselineLabel });
  if (verdicts.length === 0) {
    return '판정할 창이 없다 — 훈련 창을 채우고 나면 남는 창이 없다.';
  }
  const table = tableOf(
    ['창', '훈련 창', '앞선 창들의 1위', '그 창 초과수익', '현행값', '판정'],
    verdicts.map((verdict) => [
      String(verdict.windowIndex),
      `1~${verdict.trainedWindowCount}`,
      verdict.chosenLabel === baselineLabel
        ? `${verdict.chosenLabel} (현행 선택)`
        : verdict.chosenLabel,
      `${signedPercent(verdict.chosenExcessReturnPercent)}%`,
      `${signedPercent(verdict.baselineExcessReturnPercent)}%`,
      verdict.won === null ? '—' : verdict.won ? '승' : '패',
    ]),
  );
  const judged = verdicts.filter((verdict) => verdict.won !== null);
  const wins = judged.filter((verdict) => verdict.won === true).length;
  const differenceSum = judged.reduce(
    (sum, verdict) =>
      sum +
      ((verdict.chosenExcessReturnPercent as number) -
        (verdict.baselineExcessReturnPercent as number)),
    0,
  );
  const baselineChosen = verdicts.filter(
    (verdict) => verdict.chosenLabel === baselineLabel,
  ).length;
  return [
    table,
    '',
    `판정 ${judged.length}회 중 승 ${wins}회 · ` +
      `초과수익 차이 합계 ${signedPercent(judged.length === 0 ? null : differenceSum)}%p · ` +
      `탐색이 현행값을 그대로 고른 창 ${baselineChosen}회`,
  ].join('\n');
};

export const formatParameterSearchReport = (
  report: ParameterSearchReport,
): string => {
  const combinationCount = new Set(
    report.outcomes.map((outcome) => outcome.label),
  ).size;
  return [
    `## ${report.strategy}${report.conditionLabel === undefined ? '' : ` · ${report.conditionLabel}`}`,
    '',
    `현행값 ${report.baselineLabel} · 조합 ${combinationCount}개 · ` +
      `창 ${report.windows.length}개 · 재생 ${report.outcomes.length}회`,
    '',
    '### 창 표본',
    '',
    formatWindowTable(report.windows),
    '',
    '### 조합 종합 (창 전체 · 표본 내)',
    '',
    formatSummaryTable(report.outcomes, report.baselineLabel),
    '',
    '### 창별 코스피 초과수익 (%)',
    '',
    formatPerWindowTable(report.outcomes, report.windows, report.baselineLabel),
    '',
    '### walk-forward 표본 밖 판정',
    '',
    formatWalkForward(report.outcomes, report.baselineLabel),
  ].join('\n');
};
