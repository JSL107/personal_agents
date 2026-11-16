import {
  TUNE_ADOPTION_MARGIN_PERCENT,
  TUNE_PROBATION_MAX_DAYS,
  TUNE_PROBATION_MIN_CLOSED,
  TUNE_PROBATION_MIN_TRADE_DAYS,
} from './param-tune.type';

export interface ProbationReplay {
  slippagePercent: number;
  previousExcessPercent: number | null;
  appliedExcessPercent: number | null;
  appliedClosedCount: number;
  tradeDateCount: number;
  invariantViolated: boolean;
}

export interface RollbackInput {
  replays: ProbationReplay[];
  daysSinceApplied: number;
}

export type RollbackDecision =
  | { kind: 'WAIT' }
  | { kind: 'INCONCLUSIVE'; reason: '판정 불가' | '표본 부족' }
  | { kind: 'KEEP' }
  | { kind: 'ROLLBACK'; meanGapPercent: number };

const inconclusive = (reason: '판정 불가' | '표본 부족'): RollbackDecision => ({
  kind: 'INCONCLUSIVE',
  reason,
});

/**
 * 자동 반영된 파라미터를 시험 기간 뒤 되돌릴지 정한다. 판정 불가는 확정이 아니라
 * 다음 주 재평가 대상이다.
 */
export const decideRollback = (input: RollbackInput): RollbackDecision => {
  const { replays } = input;
  const gaps: number[] = [];
  for (const replay of replays) {
    if (
      replay.invariantViolated ||
      replay.previousExcessPercent === null ||
      replay.appliedExcessPercent === null
    ) {
      return inconclusive('판정 불가');
    }
    gaps.push(replay.appliedExcessPercent - replay.previousExcessPercent);
  }
  if (replays.length === 0) {
    return inconclusive('판정 불가');
  }

  const enoughSample =
    Math.min(...replays.map((replay) => replay.tradeDateCount)) >=
      TUNE_PROBATION_MIN_TRADE_DAYS &&
    Math.min(...replays.map((replay) => replay.appliedClosedCount)) >=
      TUNE_PROBATION_MIN_CLOSED;
  if (!enoughSample) {
    return input.daysSinceApplied > TUNE_PROBATION_MAX_DAYS
      ? inconclusive('표본 부족')
      : { kind: 'WAIT' };
  }

  const meanGapPercent = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const worseEverywhere = gaps.every((gap) => gap < 0);
  if (worseEverywhere && meanGapPercent <= -TUNE_ADOPTION_MARGIN_PERCENT) {
    return { kind: 'ROLLBACK', meanGapPercent };
  }
  return { kind: 'KEEP' };
};
