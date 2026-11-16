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

/** 평가 상세(JSON)에 문자열로 남는다. */
export enum InconclusiveReason {
  UNJUDGEABLE = '판정 불가',
  SMALL_SAMPLE = '표본 부족',
}

export interface RollbackInput {
  replays: ProbationReplay[];
  daysSinceApplied: number;
}

export type RollbackDecision =
  | { kind: 'WAIT' }
  | {
      kind: 'INCONCLUSIVE';
      reason: InconclusiveReason;
      /** true 일 때만 호출부가 시험을 확정한다. false 는 다음 주 재평가. */
      final: boolean;
    }
  | { kind: 'KEEP' }
  | { kind: 'ROLLBACK'; meanGapPercent: number };

interface InconclusiveInput {
  reason: InconclusiveReason;
  final: boolean;
}

const inconclusive = ({
  reason,
  final,
}: InconclusiveInput): RollbackDecision => ({
  kind: 'INCONCLUSIVE',
  reason,
  final,
});

/**
 * 자동 반영된 파라미터를 시험 기간 뒤 되돌릴지 정한다. 판정 불가는 상한(84일) 전에는
 * 다음 주 재평가 대상이고, 상한을 넘기면 final 로 끝낸다.
 */
export const decideRollback = (input: RollbackInput): RollbackDecision => {
  const { replays } = input;
  const expired = input.daysSinceApplied > TUNE_PROBATION_MAX_DAYS;
  const gaps: number[] = [];
  for (const replay of replays) {
    if (
      replay.invariantViolated ||
      replay.previousExcessPercent === null ||
      replay.appliedExcessPercent === null
    ) {
      return inconclusive({
        reason: InconclusiveReason.UNJUDGEABLE,
        final: expired,
      });
    }
    gaps.push(replay.appliedExcessPercent - replay.previousExcessPercent);
  }
  if (replays.length === 0) {
    return inconclusive({
      reason: InconclusiveReason.UNJUDGEABLE,
      final: expired,
    });
  }

  const enoughSample =
    Math.min(...replays.map((replay) => replay.tradeDateCount)) >=
      TUNE_PROBATION_MIN_TRADE_DAYS &&
    Math.min(...replays.map((replay) => replay.appliedClosedCount)) >=
      TUNE_PROBATION_MIN_CLOSED;
  if (!enoughSample) {
    if (expired) {
      return inconclusive({
        reason: InconclusiveReason.SMALL_SAMPLE,
        final: true,
      });
    }
    return { kind: 'WAIT' };
  }

  const meanGapPercent = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const worseEverywhere = gaps.every((gap) => gap < 0);
  if (worseEverywhere && meanGapPercent <= -TUNE_ADOPTION_MARGIN_PERCENT) {
    return { kind: 'ROLLBACK', meanGapPercent };
  }
  return { kind: 'KEEP' };
};
