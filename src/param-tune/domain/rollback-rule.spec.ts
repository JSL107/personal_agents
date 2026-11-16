import { RollbackDecisionKind } from './param-tune.type';
import { decideRollback, ProbationReplay } from './rollback-rule';

const replay = (overrides: Partial<ProbationReplay> = {}): ProbationReplay => ({
  slippagePercent: 0,
  previousExcessPercent: 1,
  appliedExcessPercent: 0,
  appliedClosedCount: 5,
  tradeDateCount: 20,
  invariantViolated: false,
  ...overrides,
});

describe('decideRollback', () => {
  it('replays 가 비면 판정 불가', () => {
    expect(decideRollback({ replays: [], daysSinceApplied: 30 })).toEqual({
      kind: RollbackDecisionKind.INCONCLUSIVE,
      reason: '판정 불가',
      final: false,
    });
  });

  it('null 이 하나라도 있으면 판정 불가', () => {
    expect(
      decideRollback({
        replays: [replay(), replay({ appliedExcessPercent: null })],
        daysSinceApplied: 30,
      }),
    ).toEqual({
      kind: RollbackDecisionKind.INCONCLUSIVE,
      reason: '판정 불가',
      final: false,
    });
    expect(
      decideRollback({
        replays: [replay({ previousExcessPercent: null })],
        daysSinceApplied: 30,
      }),
    ).toEqual({
      kind: RollbackDecisionKind.INCONCLUSIVE,
      reason: '판정 불가',
      final: false,
    });
  });

  it('null 이 84일째면 final=false', () => {
    expect(
      decideRollback({
        replays: [replay({ appliedExcessPercent: null })],
        daysSinceApplied: 84,
      }),
    ).toEqual({
      kind: RollbackDecisionKind.INCONCLUSIVE,
      reason: '판정 불가',
      final: false,
    });
  });

  it('null 이 85일째에도 있으면 final 판정 불가', () => {
    expect(
      decideRollback({
        replays: [replay({ appliedExcessPercent: null })],
        daysSinceApplied: 85,
      }),
    ).toEqual({
      kind: RollbackDecisionKind.INCONCLUSIVE,
      reason: '판정 불가',
      final: true,
    });
  });

  it('불변식 위반이 하나라도 있으면 판정 불가', () => {
    expect(
      decideRollback({
        replays: [replay({ invariantViolated: true })],
        daysSinceApplied: 30,
      }),
    ).toEqual({
      kind: RollbackDecisionKind.INCONCLUSIVE,
      reason: '판정 불가',
      final: false,
    });
  });

  it('거래일 19 면 WAIT', () => {
    expect(
      decideRollback({
        replays: [replay({ tradeDateCount: 19 })],
        daysSinceApplied: 30,
      }),
    ).toEqual({ kind: RollbackDecisionKind.WAIT });
  });

  it('청산이 모자라면 WAIT, 가장 작은 값 기준', () => {
    expect(
      decideRollback({
        replays: [replay(), replay({ appliedClosedCount: 4 })],
        daysSinceApplied: 84,
      }),
    ).toEqual({ kind: RollbackDecisionKind.WAIT });
  });

  it('85일·청산 4 면 표본 부족', () => {
    expect(
      decideRollback({
        replays: [replay({ appliedClosedCount: 4 })],
        daysSinceApplied: 85,
      }),
    ).toEqual({
      kind: RollbackDecisionKind.INCONCLUSIVE,
      reason: '표본 부족',
      final: true,
    });
  });

  it('한 조건만 열세면 KEEP', () => {
    expect(
      decideRollback({
        replays: [
          replay({ appliedExcessPercent: -5 }),
          replay({ appliedExcessPercent: 2 }),
        ],
        daysSinceApplied: 30,
      }),
    ).toEqual({ kind: RollbackDecisionKind.KEEP });
  });

  it('전 조건 열세여도 평균 gap -0.4 면 KEEP', () => {
    expect(
      decideRollback({
        replays: [replay({ appliedExcessPercent: 0.6 })],
        daysSinceApplied: 30,
      }),
    ).toEqual({ kind: RollbackDecisionKind.KEEP });
  });

  it('전 조건 열세·평균 gap -0.5 면 ROLLBACK', () => {
    expect(
      decideRollback({
        replays: [
          replay({ appliedExcessPercent: 0.5 }),
          replay({ appliedExcessPercent: 0.5 }),
        ],
        daysSinceApplied: 30,
      }),
    ).toEqual({ kind: RollbackDecisionKind.ROLLBACK, meanGapPercent: -0.5 });
  });
});
