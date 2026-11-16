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
        '• 스윙 · 손절 % · 반영 -5→-7',
        '• 장기 · 최소 거래대금 · 되돌림 5억→3억 (재생 모형 비교 기준)',
        '• 장기 · 손절 % · 실패 (a&lt;b &amp; c)',
        '• 스윙 · 최대 비중 % · 변화 없음 (후보가 기준을 넘지 못함)',
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
      '• [2026-11-09 주] 스윙 · 손절 % · 되돌리려 했으나 값이 이미 바뀌어 건너뜀',
    );
    expect(text).toContain('• 스윙 · 손절 % · [관찰] 반영했을 값 5→10');
  });

  it('평가가 있는 행은 결정이 아니라 평가를 보여준다', () => {
    const applied = {
      decision: 'APPLIED' as const,
      previousValue: -5,
      candidateValue: -7,
    };
    const lines = formatParamTuneReport([
      row({ ...applied, evaluation: 'KEEP' }),
      row({
        ...applied,
        evaluation: 'INCONCLUSIVE',
        evaluationDetail: {
          decision: { kind: 'INCONCLUSIVE', reason: '표본 부족', final: true },
        },
      }),
      row({
        decision: 'WOULD_APPLY',
        previousValue: 5,
        candidateValue: 10,
        evaluation: 'WOULD_KEEP',
      }),
      row({
        decision: 'WOULD_APPLY',
        previousValue: 5,
        candidateValue: 10,
        evaluation: 'WOULD_ROLLBACK',
      }),
    ]).split('\n');

    expect(lines.slice(1)).toEqual([
      '• 스윙 · 손절 % · 시험 통과, 유지 -5→-7',
      '• 스윙 · 손절 % · 판정할 수 없어 유지 (표본 부족)',
      '• 스윙 · 손절 % · [관찰] 가상 시험 결과: 유지했을 것',
      '• 스윙 · 손절 % · [관찰] 가상 시험 결과: 되돌렸을 것',
    ]);
    expect(lines.join('\n')).not.toContain('반영 -5→-7');
  });

  it('시험 중 건너뜀과 탐색하지 않은 회차를 한국어로 쓴다', () => {
    const lines = formatParamTuneReport([
      row({ status: 'SKIPPED_PROBATION' }),
      row({ decisionReason: 'off' }),
      row({ decisionReason: '롤백한 주라 탐색하지 않음' }),
      row({ evaluation: 'INCONCLUSIVE', evaluationDetail: null }),
    ]).split('\n');

    expect(lines.slice(1)).toEqual([
      '• 스윙 · 손절 % · 시험 중인 값이 있어 이번 주는 건너뜀',
      '• 스윙 · 손절 % · 탐색 안 함 (off)',
      '• 스윙 · 손절 % · 탐색 안 함 (롤백한 주라 탐색하지 않음)',
      '• 스윙 · 손절 % · 판정할 수 없어 유지',
    ]);
  });
});
