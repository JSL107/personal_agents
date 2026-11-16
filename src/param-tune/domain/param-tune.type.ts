import { StrategyParameterName } from '../../strategy-parameter/domain/strategy-parameter.type';

/** off: 아무것도 안 함 · observe: 판정과 원장만(값 불변) · apply: 채택 시 값 반영. */
export type ParamTuneMode = 'off' | 'observe' | 'apply';

export type TuneRunStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED_PROBATION';

export type TuneDecision = 'APPLIED' | 'WOULD_APPLY' | 'NO_CHANGE';

export type TuneEvaluation =
  | 'KEEP'
  | 'ROLLBACK'
  | 'ROLLBACK_SKIPPED'
  | 'INCONCLUSIVE'
  | 'WOULD_KEEP'
  | 'WOULD_ROLLBACK';

export interface ParameterSnapshotEntry {
  name: StrategyParameterName;
  parameterId: number;
  version: number;
  value: number;
}

/** 항상 4개이고 `STRATEGY_PARAMETER_NAMES` 순서다. */
export type ParameterSnapshot = ParameterSnapshotEntry[];

/** 축마다 시험할 후보 값. 현재 값이 격자 밖이어도 비교 기준으로는 따로 들어간다. */
export const TUNE_GRID: Record<StrategyParameterName, readonly number[]> = {
  EXIT_TAKE_PROFIT_PERCENT: [2, 5, 10, 15, 20, 30],
  EXIT_STOP_LOSS_PERCENT: [-1, -2, -3, -5, -7, -10, -15],
  MINIMUM_TURNOVER60: [100_000_000, 300_000_000, 500_000_000, 1_000_000_000],
  MAXIMUM_WEIGHT_PERCENT: [15, 20, 25],
};

export const TUNE_SLIPPAGE_PERCENTS = [0, 0.1, 0.2] as const;
export const TUNE_SEARCH_FROM = '2021-10-01';
export const TUNE_WINDOW_MONTHS = 6;
export const TUNE_ADOPTION_MARGIN_PERCENT = 0.5;

/** 주간 축 순환의 기준 월요일. 이 주가 AXIS_ORDER 의 첫 축이다. */
export const TUNE_ROTATION_ANCHOR = '2026-11-16';
export const TUNE_AXIS_ORDER: readonly StrategyParameterName[] = [
  'EXIT_TAKE_PROFIT_PERCENT',
  'EXIT_STOP_LOSS_PERCENT',
  'MINIMUM_TURNOVER60',
  'MAXIMUM_WEIGHT_PERCENT',
];

export const TUNE_EXCLUSION_DAYS = 56;
export const TUNE_PROBATION_MAX_DAYS = 84;
export const TUNE_PROBATION_MIN_TRADE_DAYS = 20;
export const TUNE_PROBATION_MIN_CLOSED = 5;

export const TUNE_CHILD_TIMEOUT_MS = 3_600_000;
export const TUNE_RUNNING_STALE_MS = 5_400_000;
