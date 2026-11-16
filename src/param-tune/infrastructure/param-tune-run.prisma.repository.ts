import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ParameterTuneRun, Prisma } from '@prisma/client';

import { utcMidnightOf } from '../../common/util/kst-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ActivateNewVersionResult,
  StrategyParameterName,
  StrategyParameterStrategy,
} from '../../strategy-parameter/domain/strategy-parameter.type';
import {
  activateNewVersionWith,
  isActivationConflict,
  readParameterSnapshot,
} from '../../strategy-parameter/infrastructure/strategy-parameter.prisma.repository';
import {
  ParameterSnapshot,
  TUNE_EXCLUSION_DAYS,
  TUNE_RUNNING_STALE_MS,
  TuneDecision,
  TuneEvaluation,
  TuneRunStatus,
} from '../domain/param-tune.type';
import {
  AppliedPeriod,
  CachedVerdict,
  ClaimResult,
  CommitAdoptionInput,
  CommitRollbackInput,
  MarkNotifiedInput,
  OpenProbation,
  ParamTuneRunPort,
  TuneRunPatch,
  TuneRunRow,
} from '../domain/port/param-tune-run.port';

const DAY_MS = 86_400_000;
const NOTIFIABLE_STATUSES: TuneRunStatus[] = [
  TuneRunStatus.DONE,
  TuneRunStatus.FAILED,
  TuneRunStatus.SKIPPED_PROBATION,
];

/** 시험 대상 행에서 비어 있으면 안 되는 값 컬럼. */
enum RequiredValueField {
  PREVIOUS = 'previousValue',
  CANDIDATE = 'candidateValue',
}

interface RequiredValue {
  row: ParameterTuneRun;
  field: RequiredValueField;
}

interface ProbationSource {
  row: ParameterTuneRun;
  startedOn: Date;
}

const toNumber = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : value.toNumber();

const toRow = (row: ParameterTuneRun): TuneRunRow => ({
  id: row.id,
  weekStart: row.weekStart,
  strategy: row.strategy as StrategyParameterStrategy,
  axis: row.axis as StrategyParameterName,
  status: row.status as TuneRunStatus,
  attemptToken: row.attemptToken,
  startedAt: row.startedAt,
  failureReason: row.failureReason,
  parameterSnapshot: row.parameterSnapshot as ParameterSnapshot | null,
  verdictKey: row.verdictKey,
  verdict: row.verdict,
  decision: row.decision as TuneDecision | null,
  decisionReason: row.decisionReason,
  previousValue: toNumber(row.previousValue),
  candidateValue: toNumber(row.candidateValue),
  previousParameterId: row.previousParameterId,
  appliedParameterId: row.appliedParameterId,
  appliedAt: row.appliedAt,
  evaluation: row.evaluation as TuneEvaluation | null,
  evaluatedAt: row.evaluatedAt,
  evaluationDetail: row.evaluationDetail,
  notifiedAt: row.notifiedAt,
  agentRunId: row.agentRunId,
});

// 값이 비면 반쯤 쓰인 행이다. 0 으로 메우면 롤백이 손절을 0% 로 되돌릴 수 있어 던진다.
const requireValue = ({ row, field }: RequiredValue): number => {
  const value = toNumber(row[field]);
  if (value === null) {
    throw new Error(`parameter_tune_run id=${row.id} 의 ${field} 가 비어 있다`);
  }
  return value;
};

const toProbation = ({ row, startedOn }: ProbationSource): OpenProbation => ({
  runId: row.id,
  axis: row.axis as StrategyParameterName,
  previousValue: requireValue({ row, field: RequiredValueField.PREVIOUS }),
  candidateValue: requireValue({ row, field: RequiredValueField.CANDIDATE }),
  previousParameterId: row.previousParameterId,
  appliedParameterId: row.appliedParameterId,
  startedOn,
});

// 패치의 JSON 필드는 호출부가 만든 순수 객체라 Prisma 입력 타입으로 단언한다.
const toUpdateData = (
  patch: TuneRunPatch,
): Prisma.ParameterTuneRunUpdateManyMutationInput =>
  patch as Prisma.ParameterTuneRunUpdateManyMutationInput;

interface ActivationTransaction {
  strategy: StrategyParameterStrategy;
  work: (tx: Prisma.TransactionClient) => Promise<ActivateNewVersionResult>;
}

@Injectable()
export class ParamTuneRunPrismaRepository implements ParamTuneRunPort {
  constructor(private readonly prisma: PrismaService) {}

  async claim(input: {
    weekStart: string;
    strategy: StrategyParameterStrategy;
    axis: StrategyParameterName;
    now: Date;
  }): Promise<ClaimResult> {
    const weekStart = utcMidnightOf(input.weekStart);
    const where = {
      weekStart_strategy: { weekStart, strategy: input.strategy },
    };
    const found = await this.prisma.parameterTuneRun.findUnique({ where });
    const attemptToken = randomUUID();

    if (found === null) {
      try {
        const created = await this.prisma.parameterTuneRun.create({
          data: {
            weekStart,
            strategy: input.strategy,
            axis: input.axis,
            status: TuneRunStatus.RUNNING,
            attemptToken,
            startedAt: input.now,
          },
        });
        return { kind: 'CLAIMED', runId: created.id, attemptToken };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const concurrent = await this.prisma.parameterTuneRun.findUnique({
            where,
          });
          if (concurrent !== null) {
            return { kind: 'ALREADY_RUNNING', runId: concurrent.id };
          }
        }
        throw error;
      }
    }

    if (
      found.status === TuneRunStatus.DONE ||
      found.status === TuneRunStatus.SKIPPED_PROBATION
    ) {
      return { kind: 'ALREADY_DONE', runId: found.id };
    }

    const stale =
      found.status === TuneRunStatus.FAILED ||
      found.startedAt.getTime() + TUNE_RUNNING_STALE_MS < input.now.getTime();
    if (!stale) {
      return { kind: 'ALREADY_RUNNING', runId: found.id };
    }

    // 읽은 상태를 통째로 조건으로 건다. 먼저 재선점한 쪽이 이기고, 그 사이 옛 프로세스가
    // 같은 토큰으로 DONE 을 썼으면 그 행을 RUNNING 으로 되돌리지 않고 count 0 으로 물러난다.
    const reclaimed = await this.prisma.parameterTuneRun.updateMany({
      where: {
        id: found.id,
        attemptToken: found.attemptToken,
        status: found.status,
        startedAt: found.startedAt,
      },
      data: {
        status: TuneRunStatus.RUNNING,
        attemptToken,
        startedAt: input.now,
        failureReason: null,
        // 발송된 FAILED 행을 재선점하면 새 결과를 다시 알려야 한다.
        notifiedAt: null,
        axis: input.axis,
      },
    });
    if (reclaimed.count === 0) {
      return { kind: 'ALREADY_RUNNING', runId: found.id };
    }
    return { kind: 'CLAIMED', runId: found.id, attemptToken };
  }

  async finish(input: {
    runId: number;
    attemptToken: string;
    patch: TuneRunPatch;
  }): Promise<boolean> {
    const result = await this.prisma.parameterTuneRun.updateMany({
      where: {
        id: input.runId,
        status: TuneRunStatus.RUNNING,
        attemptToken: input.attemptToken,
      },
      data: toUpdateData(input.patch),
    });
    return result.count === 1;
  }

  async markFailed(input: {
    runId: number;
    attemptToken: string;
    reason: string;
  }): Promise<boolean> {
    return this.finish({
      runId: input.runId,
      attemptToken: input.attemptToken,
      patch: { status: TuneRunStatus.FAILED, failureReason: input.reason },
    });
  }

  async findOpenProbation(
    strategy: StrategyParameterStrategy,
  ): Promise<OpenProbation | null> {
    const row = await this.prisma.parameterTuneRun.findFirst({
      where: { strategy, decision: TuneDecision.APPLIED, evaluation: null },
      orderBy: { id: 'desc' },
    });
    if (row === null) {
      return null;
    }
    return toProbation({ row, startedOn: row.appliedAt ?? row.createdAt });
  }

  async findWouldApplyUnevaluated(
    strategy: StrategyParameterStrategy,
  ): Promise<OpenProbation[]> {
    const rows = await this.prisma.parameterTuneRun.findMany({
      where: { strategy, decision: TuneDecision.WOULD_APPLY, evaluation: null },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      ...toProbation({ row, startedOn: row.createdAt }),
      previousParameterId: null,
      appliedParameterId: null,
    }));
  }

  async settleEvaluation(input: {
    runId: number;
    evaluation: TuneEvaluation;
    detail: unknown;
  }): Promise<boolean> {
    const result = await this.prisma.parameterTuneRun.updateMany({
      where: { id: input.runId, evaluatedAt: null },
      data: {
        evaluation: input.evaluation,
        evaluatedAt: new Date(),
        evaluationDetail: input.detail as Prisma.InputJsonValue,
        // 평가가 바뀐 결과도 다시 알려야 한다.
        notifiedAt: null,
      },
    });
    return result.count === 1;
  }

  async commitAdoption(
    input: CommitAdoptionInput,
  ): Promise<ActivateNewVersionResult> {
    return await this.inActivation({
      strategy: input.activation.strategy,
      work: async (tx) => {
        const result = await activateNewVersionWith({
          tx,
          input: input.activation,
        });
        if (result.kind === 'CONFLICT') {
          return result;
        }
        const written = await tx.parameterTuneRun.updateMany({
          where: {
            id: input.runId,
            status: TuneRunStatus.RUNNING,
            attemptToken: input.attemptToken,
          },
          data: toUpdateData({
            ...input.patch,
            appliedParameterId: result.parameterId,
            appliedAt: new Date(),
          }),
        });
        // 토큰을 잃은 실행은 값을 바꾸지 못한다 — 던져서 활성화까지 되돌린다.
        if (written.count === 0) {
          throw new Error(
            `parameter_tune_run id=${input.runId}: 토큰을 잃어 반영을 되돌렸다`,
          );
        }
        return result;
      },
    });
  }

  async commitRollback(
    input: CommitRollbackInput,
  ): Promise<ActivateNewVersionResult> {
    return await this.inActivation({
      strategy: input.activation.strategy,
      work: async (tx) => {
        const result = await activateNewVersionWith({
          tx,
          input: input.activation,
        });
        if (result.kind === 'CONFLICT') {
          return result;
        }
        const written = await tx.parameterTuneRun.updateMany({
          where: { id: input.runId, evaluatedAt: null },
          data: {
            evaluation: TuneEvaluation.ROLLBACK,
            evaluatedAt: new Date(),
            evaluationDetail: input.detail as Prisma.InputJsonValue,
            notifiedAt: null,
          },
        });
        if (written.count === 0) {
          throw new Error(
            `parameter_tune_run id=${input.runId}: 이미 평가된 시험이라 롤백을 되돌렸다`,
          );
        }
        return result;
      },
    });
  }

  async findExcludedValues(input: {
    strategy: StrategyParameterStrategy;
    axis: StrategyParameterName;
    now: Date;
  }): Promise<number[]> {
    const rows = await this.prisma.parameterTuneRun.findMany({
      where: {
        strategy: input.strategy,
        axis: input.axis,
        evaluation: TuneEvaluation.ROLLBACK,
        evaluatedAt: {
          gte: new Date(input.now.getTime() - TUNE_EXCLUSION_DAYS * DAY_MS),
        },
      },
      select: { candidateValue: true },
    });
    return rows.flatMap((row) => {
      const value = toNumber(row.candidateValue);
      return value === null ? [] : [value];
    });
  }

  async findVerdictByKey(input: {
    strategy: StrategyParameterStrategy;
    verdictKey: string;
  }): Promise<CachedVerdict | null> {
    const row = await this.prisma.parameterTuneRun.findFirst({
      where: {
        strategy: input.strategy,
        verdictKey: input.verdictKey,
        status: TuneRunStatus.DONE,
        verdict: { not: Prisma.DbNull },
      },
      orderBy: { id: 'desc' },
    });
    return row === null ? null : { runId: row.id, verdict: row.verdict };
  }

  async findUnnotified(): Promise<TuneRunRow[]> {
    const rows = await this.prisma.parameterTuneRun.findMany({
      where: { notifiedAt: null, status: { in: NOTIFIABLE_STATUSES } },
      orderBy: { id: 'asc' },
    });
    return rows.map(toRow);
  }

  async markNotified({ ids, at }: MarkNotifiedInput): Promise<void> {
    await this.prisma.parameterTuneRun.updateMany({
      where: { id: { in: ids } },
      data: { notifiedAt: at },
    });
  }

  async countAppliedBetween({
    since,
    until,
  }: AppliedPeriod): Promise<number> {
    const period = { gte: since, lt: until };
    return this.prisma.parameterTuneRun.count({
      where: {
        OR: [
          { appliedAt: period },
          { evaluation: TuneEvaluation.ROLLBACK, evaluatedAt: period },
        ],
      },
    });
  }

  // 값 활성화가 들어간 트랜잭션. 충돌 코드는 activateNewVersion 과 같게 CONFLICT 로 바꾼다.
  private async inActivation(
    activation: ActivationTransaction,
  ): Promise<ActivateNewVersionResult> {
    try {
      return await this.prisma.$transaction(activation.work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isActivationConflict(error)) {
        return {
          kind: 'CONFLICT',
          actual: await readParameterSnapshot({
            client: this.prisma,
            strategy: activation.strategy,
          }),
        };
      }
      throw error;
    }
  }
}
