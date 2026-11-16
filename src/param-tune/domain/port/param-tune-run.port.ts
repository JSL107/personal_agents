import {
  ActivateNewVersionInput,
  ActivateNewVersionResult,
  StrategyParameterName,
  StrategyParameterStrategy,
} from '../../../strategy-parameter/domain/strategy-parameter.type';
import {
  ParameterSnapshot,
  TuneDecision,
  TuneEvaluation,
  TuneRunStatus,
} from '../param-tune.type';
import { ClaimKind } from '../param-tune.type';

export const PARAM_TUNE_RUN_PORT = Symbol('PARAM_TUNE_RUN_PORT');

/** `parameter_tune_run` 행을 도메인 타입으로 옮긴 것. Decimal 은 number 로 바뀐다. */
export interface TuneRunRow {
  id: number;
  weekStart: Date;
  strategy: StrategyParameterStrategy;
  axis: StrategyParameterName;
  status: TuneRunStatus;
  attemptToken: string;
  startedAt: Date;
  failureReason: string | null;
  parameterSnapshot: ParameterSnapshot | null;
  verdictKey: string | null;
  verdict: unknown;
  decision: TuneDecision | null;
  decisionReason: string | null;
  previousValue: number | null;
  candidateValue: number | null;
  previousParameterId: number | null;
  appliedParameterId: number | null;
  appliedAt: Date | null;
  evaluation: TuneEvaluation | null;
  evaluatedAt: Date | null;
  evaluationDetail: unknown;
  notifiedAt: Date | null;
  agentRunId: number | null;
}

/** `finish` 가 쓸 수 있는 필드만 모은 부분 갱신. 없는 키는 건드리지 않는다. */
export interface TuneRunPatch {
  status?: TuneRunStatus;
  failureReason?: string | null;
  parameterSnapshot?: ParameterSnapshot | null;
  verdictKey?: string | null;
  verdict?: unknown;
  decision?: TuneDecision | null;
  decisionReason?: string | null;
  previousValue?: number | null;
  candidateValue?: number | null;
  previousParameterId?: number | null;
  appliedParameterId?: number | null;
  appliedAt?: Date | null;
}

export type ClaimResult =
  | { kind: ClaimKind.CLAIMED; runId: number; attemptToken: string }
  | { kind: ClaimKind.ALREADY_RUNNING; runId: number }
  | { kind: ClaimKind.ALREADY_DONE; runId: number };

export interface OpenProbation {
  runId: number;
  axis: StrategyParameterName;
  previousValue: number;
  candidateValue: number;
  previousParameterId: number | null;
  appliedParameterId: number | null;
  startedOn: Date;
}

export interface CachedVerdict {
  runId: number;
  verdict: unknown;
}

export interface CommitAdoptionInput {
  runId: number;
  attemptToken: string;
  activation: ActivateNewVersionInput;
  /** 회차를 끝내는 패치 전부. appliedParameterId·appliedAt 은 저장소가 채운다. */
  patch: TuneRunPatch;
}

export interface CommitRollbackInput {
  /** 롤백할 시험 행. */
  runId: number;
  activation: ActivateNewVersionInput;
  detail: unknown;
}

/** until 은 미포함. */
export interface AppliedPeriod {
  since: Date;
  until: Date;
}

export interface MarkNotifiedInput {
  ids: number[];
  at: Date;
}

/** weekStart 는 'YYYY-MM-DD'. */
export interface ClaimInput {
  weekStart: string;
  strategy: StrategyParameterStrategy;
  axis: StrategyParameterName;
  now: Date;
}

export interface FinishInput {
  runId: number;
  attemptToken: string;
  patch: TuneRunPatch;
}

export interface MarkFailedInput {
  runId: number;
  attemptToken: string;
  reason: string;
}

export interface SettleEvaluationInput {
  runId: number;
  evaluation: TuneEvaluation;
  detail: unknown;
}

export interface FindExcludedValuesInput {
  strategy: StrategyParameterStrategy;
  axis: StrategyParameterName;
  now: Date;
}

export interface FindVerdictByKeyInput {
  strategy: StrategyParameterStrategy;
  verdictKey: string;
}

export interface ParamTuneRunPort {
  /** weekStart 는 'YYYY-MM-DD'. 이 주·전략의 회차를 선점한다. */
  claim(input: ClaimInput): Promise<ClaimResult>;

  /** RUNNING 이고 토큰이 같을 때만 쓴다. 늦게 끝난 자식 프로세스가 덮지 못하게 한다. */
  finish(input: FinishInput): Promise<boolean>;

  markFailed(input: MarkFailedInput): Promise<boolean>;

  /** decision=APPLIED 이고 아직 평가 전인 최신 1건. startedOn = appliedAt. */
  findOpenProbation(
    strategy: StrategyParameterStrategy,
  ): Promise<OpenProbation | null>;

  /** observe 가상 시험 대상. startedOn = createdAt. 시험 중 판정(SKIPPED_PROBATION)에는 쓰지 않는다. */
  findWouldApplyUnevaluated(
    strategy: StrategyParameterStrategy,
  ): Promise<OpenProbation[]>;

  /** 평가가 아직 없을 때만 한 번 기록한다. 이미 있으면 false. */
  settleEvaluation(input: SettleEvaluationInput): Promise<boolean>;

  /**
   * 값 활성화와 회차 기록을 한 트랜잭션에 묶는다. 활성화가 되면 같은 트랜잭션에서 RUNNING·토큰
   * 조건으로 patch 를 쓰고, 토큰을 잃었으면 던져 활성화까지 되돌린다. CONFLICT 면 아무것도 쓰지 않는다.
   */
  commitAdoption(input: CommitAdoptionInput): Promise<ActivateNewVersionResult>;

  /**
   * 롤백 활성화와 시험 행의 ROLLBACK 확정을 한 트랜잭션에 묶는다. 이미 평가된 행이면 던져
   * 활성화까지 되돌린다. CONFLICT 면 아무것도 쓰지 않는다.
   */
  commitRollback(input: CommitRollbackInput): Promise<ActivateNewVersionResult>;

  /** 최근 56일 안에 롤백된 후보 값. */
  findExcludedValues(input: FindExcludedValuesInput): Promise<number[]>;

  /** 같은 전략의 판정만 재사용한다. */
  findVerdictByKey(input: FindVerdictByKeyInput): Promise<CachedVerdict | null>;

  findUnnotified(): Promise<TuneRunRow[]>;

  markNotified(input: MarkNotifiedInput): Promise<void>;

  /** [since, until) 에 반영됐거나 롤백된 행 수. 롤백은 새 행을 만들지 않으니 같은 행을 한 번만 센다. */
  countAppliedBetween(input: AppliedPeriod): Promise<number>;
}
