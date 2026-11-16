import { StrategyParameterName } from '../../strategy-parameter/domain/strategy-parameter.type';

/** off: 아무것도 안 함 · observe: 판정과 원장만(값 불변) · apply: 채택 시 값 반영. 값은 env 문자열 그대로다. */
export enum ParamTuneMode {
  OFF = 'off',
  OBSERVE = 'observe',
  APPLY = 'apply',
}

// 아래 세 enum 의 값은 parameter_tune_run 에 문자열로 저장된다. 바꾸면 기존 행을 못 읽는다.
export enum TuneRunStatus {
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
  SKIPPED_PROBATION = 'SKIPPED_PROBATION',
}

export enum TuneDecision {
  APPLIED = 'APPLIED',
  WOULD_APPLY = 'WOULD_APPLY',
  NO_CHANGE = 'NO_CHANGE',
}

export enum TuneEvaluation {
  KEEP = 'KEEP',
  ROLLBACK = 'ROLLBACK',
  ROLLBACK_SKIPPED = 'ROLLBACK_SKIPPED',
  INCONCLUSIVE = 'INCONCLUSIVE',
  WOULD_KEEP = 'WOULD_KEEP',
  WOULD_ROLLBACK = 'WOULD_ROLLBACK',
}

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

/** env 미설정 시 모드. 값은 바꾸지 않고 원장만 쌓는 쪽이 안전한 기본이다. */
export const DEFAULT_PARAM_TUNE_MODE = ParamTuneMode.OBSERVE;

// 아래 네 enum 은 저장하지 않고 프로세스 안에서만 오가는 판정 결과의 갈래다.
export enum AdoptionDecisionKind {
  ADOPT = 'ADOPT',
  NO_CHANGE = 'NO_CHANGE',
}

export enum RollbackDecisionKind {
  WAIT = 'WAIT',
  INCONCLUSIVE = 'INCONCLUSIVE',
  KEEP = 'KEEP',
  ROLLBACK = 'ROLLBACK',
}

export enum ClaimKind {
  CLAIMED = 'CLAIMED',
  ALREADY_RUNNING = 'ALREADY_RUNNING',
  ALREADY_DONE = 'ALREADY_DONE',
}

export enum ChildOutcomeKind {
  EXITED = 'EXITED',
  TIMEOUT = 'TIMEOUT',
  SPAWN_FAILED = 'SPAWN_FAILED',
}
