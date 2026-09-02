import { ScreenStrategy } from '../../screener/domain/screener-rule';
import {
  ConditionOutcomes,
  evaluateRobustWalkForward,
  evaluateWalkForward,
  SearchWindow,
  summarizeAcrossConditions,
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
      '창당 체결',
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
      plainNumber(
        summary.windowCount === 0
          ? null
          : summary.filledCountTotal / summary.windowCount,
        0,
      ),
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
    '> 순위는 코스피 초과수익 기준이고, 그 값은 **사이클당 평균**이다 — 체결마다 붙는 비용',
    '> (슬리피지 등)이 사이클마다 같은 비율이면 모든 조합을 똑같이 깎아 순위에 거의 잡히지',
    '> 않는다. 회전이 두 배인 조합도 같은 대우를 받으므로 창당 체결 열을 함께 읽을 것.',
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

export interface RobustnessReport {
  strategy: ScreenStrategy;
  baselineLabel: string;
  conditions: ConditionOutcomes[];
}

/**
 * 슬리피지 수준을 가로지른 판정. **한 수준의 1위가 아니라 모든 수준에서 버티는 값**을 찾는다.
 */
export const formatRobustnessReport = (report: RobustnessReport): string => {
  const labels = report.conditions.map((condition) => condition.conditionLabel);
  const summaries = summarizeAcrossConditions({
    conditions: report.conditions,
    baselineLabel: report.baselineLabel,
  });
  const table = tableOf(
    ['조합', ...labels, '**최악**', '최선', '종결계'],
    summaries
      .slice(0, 12)
      .concat(
        summaries.some((summary) => summary.label === report.baselineLabel)
          ? []
          : [],
      )
      .map((summary) => [
        labelCell(summary.label, report.baselineLabel),
        ...summary.meanRankByCondition.map((rank) => plainNumber(rank)),
        `**${plainNumber(summary.worstMeanRank)}**`,
        plainNumber(summary.bestMeanRank),
        String(summary.closedCountTotal),
      ]),
  );

  const verdicts = evaluateRobustWalkForward({
    conditions: report.conditions,
    baselineLabel: report.baselineLabel,
  });
  const judged = verdicts.filter(
    (verdict) => verdict.wonEveryCondition !== null,
  );
  const wins = judged.filter(
    (verdict) => verdict.wonEveryCondition === true,
  ).length;
  const verdictTable = tableOf(
    ['창', '앞선 창들의 1위 (최악 기준)', ...labels, '전 조건 승'],
    verdicts.map((verdict) => [
      String(verdict.windowIndex),
      verdict.chosenLabel === report.baselineLabel
        ? `${verdict.chosenLabel} (현행 선택)`
        : verdict.chosenLabel,
      ...verdict.byCondition.map((entry) =>
        entry.won === null ? '—' : entry.won ? '승' : '패',
      ),
      verdict.wonEveryCondition === null
        ? '—'
        : verdict.wonEveryCondition
          ? '승'
          : '패',
    ]),
  );

  return [
    `## ${report.strategy} · 슬리피지 가정을 가로지른 판정`,
    '',
    '> 한 수준에서 1위여도 다른 수준에서 무너지는 값은 "이겼다" 가 아니라 **"그 가정에서',
    '> 이겼다"** 다. 슬리피지 크기는 봉으로 알 수 없고 모델링은 검증할 수 없으므로, 값을',
    '> 고르려면 가정에 흔들리지 않는 쪽을 골라야 한다. 순위는 **가장 나쁜 조건**으로 세운다.',
    '',
    '### 조건별 순위평균 (상위 12)',
    '',
    table,
    '',
    '### 최악 기준 walk-forward — 모든 조건에서 이겨야 승',
    '',
    verdictTable,
    '',
    `판정 ${judged.length}회 중 전 조건 승 ${wins}회`,
  ].join('\n');
};
