import { WindowOutcome } from '../domain/parameter-search';
import {
  formatParameterSearchReport,
  ParameterSearchReport,
  SearchWindowSummary,
} from './parameter-search.formatter';

const windowSummaryOf = (index: number): SearchWindowSummary => ({
  window: { index, from: `202${index}-01-01`, to: `202${index}-06-30` },
  tradeDateCount: 120,
  benchmarkReturnPercent: 5,
  baselineFilledCount: 70,
  baselineClosedCount: 34,
});

const outcomeOf = (
  windowIndex: number,
  label: string,
  excessReturnPercent: number | null,
): WindowOutcome => ({
  windowIndex,
  label,
  excessReturnPercent,
  finalReturnPercent: 1,
  maximumLossPercent: -10,
  hitRatePercent: 50,
  closedCount: 10,
  filledCount: 20,
});

const REPORT: ParameterSearchReport = {
  strategy: 'SWING',
  baselineLabel: '+10/-5 · 5억 · 20%',
  windows: [windowSummaryOf(1), windowSummaryOf(2), windowSummaryOf(3)],
  outcomes: [
    outcomeOf(1, '+10/-5 · 5억 · 20%', 0),
    outcomeOf(1, '+5/-3 · 5억 · 20%', 5),
    outcomeOf(2, '+10/-5 · 5억 · 20%', 0),
    outcomeOf(2, '+5/-3 · 5억 · 20%', 5),
    outcomeOf(3, '+10/-5 · 5억 · 20%', 2),
    outcomeOf(3, '+5/-3 · 5억 · 20%', -3),
  ],
};

describe('formatParameterSearchReport', () => {
  it('창 표본·조합 종합·창별 성적·walk-forward 를 모두 낸다', () => {
    const report = formatParameterSearchReport(REPORT);

    expect(report).toContain('### 창 표본');
    expect(report).toContain('### 조합 종합 (창 전체 · 표본 내)');
    expect(report).toContain('### 창별 코스피 초과수익 (%)');
    expect(report).toContain('### walk-forward 표본 밖 판정');
    expect(report).toContain('조합 2개 · 창 3개 · 재생 6회');
  });

  it('회전을 창당 체결로 함께 낸다', () => {
    // 순위 기준인 초과수익은 사이클당 평균이라 회전을 보지 않는다. 체결마다 붙는
    // 비용(슬리피지)이 순위에 안 잡히므로, 회전이 표에 없으면 판단이 성립하지 않는다.
    const report = formatParameterSearchReport(REPORT);

    expect(report).toContain('창당 체결');
    expect(report).toContain('사이클당 평균');
  });

  it('창당 체결을 합계가 아니라 창당 평균으로 찍는다', () => {
    // 합계를 그대로 찍으면 창 수가 다른 조합끼리 회전을 견줄 수 없다.
    const report = formatParameterSearchReport({
      ...REPORT,
      outcomes: REPORT.outcomes.map((outcome) => ({
        ...outcome,
        filledCount: outcome.label === '+5/-3 · 5억 · 20%' ? 411 : 100,
      })),
    });

    // 창 3개 x 411 = 1,233 이므로 창당 411 이 찍혀야 한다(합계 1233 이 아니다).
    expect(report).toContain('| 411 |');
    expect(report).not.toContain('| 1233 |');
    expect(report).toContain('| 100 |');
  });

  it('현행값 행을 표에서 눈에 띄게 표시한다', () => {
    const report = formatParameterSearchReport(REPORT);

    expect(report).toContain('**+10/-5 · 5억 · 20%** (현행)');
  });

  it('표본 밖에서 후보가 진 것을 판정으로 적는다', () => {
    const report = formatParameterSearchReport(REPORT);

    expect(report).toContain('판정 1회 중 승 0회');
  });

  it('값이 없는 지표는 0 이 아니라 자리표시로 낸다', () => {
    // 0 으로 찍으면 "쟀는데 0" 과 "재지 못했다" 가 구분되지 않는다.
    const report = formatParameterSearchReport({
      ...REPORT,
      outcomes: REPORT.outcomes.map((outcome) => ({
        ...outcome,
        excessReturnPercent: null,
      })),
    });

    expect(report).toContain('—');
    expect(report).not.toContain('+0.00%');
  });
});
