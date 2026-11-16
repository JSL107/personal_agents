import { TuneRunRow } from '../domain/port/param-tune-run.port';
import { formatParamTuneReport } from './param-tune.formatter';

const row = (overrides: Partial<TuneRunRow>): TuneRunRow => ({
  id: 1,
  weekStart: new Date('2026-11-16T00:00:00.000Z'),
  strategy: 'SWING',
  axis: 'EXIT_STOP_LOSS_PERCENT',
  status: 'DONE',
  attemptToken: 't',
  startedAt: new Date('2026-11-21T17:00:00.000Z'),
  failureReason: null,
  parameterSnapshot: null,
  verdictKey: null,
  verdict: null,
  decision: null,
  decisionReason: null,
  previousValue: null,
  candidateValue: null,
  previousParameterId: null,
  appliedParameterId: null,
  appliedAt: null,
  evaluation: null,
  evaluatedAt: null,
  evaluationDetail: null,
  notifiedAt: null,
  agentRunId: null,
  ...overrides,
});

describe('formatParamTuneReport', () => {
  it('적용·롤백·실패·변화 없음을 한 줄씩 낸다', () => {
    const text = formatParamTuneReport([
      row({ decision: 'APPLIED', previousValue: -5, candidateValue: -7 }),
      row({
        id: 2,
        strategy: 'LONG_TERM',
        axis: 'MINIMUM_TURNOVER60',
        evaluation: 'ROLLBACK',
        previousValue: 300_000_000,
        candidateValue: 500_000_000,
      }),
      row({
        id: 3,
        strategy: 'LONG_TERM',
        status: 'FAILED',
        failureReason: 'a<b & c\n두번째 줄',
      }),
      row({
        id: 4,
        decision: 'NO_CHANGE',
        decisionReason: '후보가 기준을 넘지 못함',
        axis: 'MAXIMUM_WEIGHT_PERCENT',
      }),
    ]);

    expect(text).toBe(
      [
        '*투자 파라미터 자동 조정* (2026-11-16 주)',
        '• 스윙 · 손절 % · APPLIED -5→-7',
        '• 장기 · 최소 거래대금 · ROLLBACK 5억→3억 (재생 모형 비교 기준)',
        '• 장기 · 손절 % · 실패(a&lt;b &amp; c)',
        '• 스윙 · 최대 비중 % · NO_CHANGE(후보가 기준을 넘지 못함)',
      ].join('\n'),
    );
  });

  it('지난 주 행에는 주 표시를 붙인다', () => {
    const text = formatParamTuneReport([
      row({
        weekStart: new Date('2026-11-09T00:00:00.000Z'),
        evaluation: 'ROLLBACK_SKIPPED',
      }),
      row({
        id: 2,
        decision: 'WOULD_APPLY',
        previousValue: 5,
        candidateValue: 10,
      }),
    ]);

    expect(text).toContain(
      '• [2026-11-09 주] 스윙 · 손절 % · ROLLBACK_SKIPPED (재생 모형 비교 기준)',
    );
    expect(text).toContain('• 스윙 · 손절 % · WOULD_APPLY 5→10');
  });
});
