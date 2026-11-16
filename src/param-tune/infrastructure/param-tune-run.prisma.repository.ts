import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ParameterTuneRun, Prisma } from '@prisma/client';

import { utcMidnightOf } from '../../common/util/kst-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  StrategyParameterName,
  StrategyParameterStrategy,
} from '../../strategy-parameter/domain/strategy-parameter.type';
import {
  ParameterSnapshot,
  TUNE_EXCLUSION_DAYS,
  TUNE_RUNNING_STALE_MS,
  TuneDecision,
  TuneEvaluation,
  TuneRunStatus,
} from '../domain/param-tune.type';
import {
  CachedVerdict,
  ClaimResult,
  OpenProbation,
  ParamTuneRunPort,
  TuneRunPatch,
  TuneRunRow,
} from '../domain/port/param-tune-run.port';

const DAY_MS = 86_400_000;
const NOTIFIABLE_STATUSES: TuneRunStatus[] = [
  'DONE',
  'FAILED',
  'SKIPPED_PROBATION',
];

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

const toProbation = (
  row: ParameterTuneRun,
  startedOn: Date,
): OpenProbation => ({
  runId: row.id,
  axis: row.axis as StrategyParameterName,
  previousValue: row.previousValue?.toNumber() ?? 0,
  candidateValue: row.candidateValue?.toNumber() ?? 0,
  previousParameterId: row.previousParameterId,
  appliedParameterId: row.appliedParameterId,
  startedOn,
});

// 패치의 JSON 필드는 호출부가 만든 순수 객체라 Prisma 입력 타입으로 단언한다.
const toUpdateData = (
  patch: TuneRunPatch,
): Prisma.ParameterTuneRunUpdateManyMutationInput =>
  patch as Prisma.ParameterTuneRunUpdateManyMutationInput;

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
            status: 'RUNNING',
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

    if (found.status === 'DONE' || found.status === 'SKIPPED_PROBATION') {
      return { kind: 'ALREADY_DONE', runId: found.id };
    }

    const stale =
      found.status === 'FAILED' ||
      found.startedAt.getTime() + TUNE_RUNNING_STALE_MS < input.now.getTime();
    if (!stale) {
      return { kind: 'ALREADY_RUNNING', runId: found.id };
    }

    // 옛 토큰을 조건으로 걸어, 먼저 재선점한 쪽이 이기고 나머지는 count 0 으로 물러난다.
    const reclaimed = await this.prisma.parameterTuneRun.updateMany({
      where: { id: found.id, attemptToken: found.attemptToken },
      data: {
        status: 'RUNNING',
        attemptToken,
        startedAt: input.now,
        failureReason: null,
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
        status: 'RUNNING',
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
      patch: { status: 'FAILED', failureReason: input.reason },
    });
  }

  async findOpenProbation(
    strategy: StrategyParameterStrategy,
  ): Promise<OpenProbation | null> {
    const row = await this.prisma.parameterTuneRun.findFirst({
      where: { strategy, decision: 'APPLIED', evaluation: null },
      orderBy: { id: 'desc' },
    });
    if (row === null) {
      return null;
    }
    return toProbation(row, row.appliedAt ?? row.createdAt);
  }

  async findWouldApplyUnevaluated(
    strategy: StrategyParameterStrategy,
  ): Promise<OpenProbation[]> {
    const rows = await this.prisma.parameterTuneRun.findMany({
      where: { strategy, decision: 'WOULD_APPLY', evaluation: null },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      ...toProbation(row, row.createdAt),
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

  async findExcludedValues(input: {
    strategy: StrategyParameterStrategy;
    axis: StrategyParameterName;
    now: Date;
  }): Promise<number[]> {
    const rows = await this.prisma.parameterTuneRun.findMany({
      where: {
        strategy: input.strategy,
        axis: input.axis,
        evaluation: 'ROLLBACK',
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

  async findVerdictByKey(verdictKey: string): Promise<CachedVerdict | null> {
    const row = await this.prisma.parameterTuneRun.findFirst({
      where: {
        verdictKey,
        status: 'DONE',
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

  async markNotified(ids: number[], at: Date): Promise<void> {
    await this.prisma.parameterTuneRun.updateMany({
      where: { id: { in: ids } },
      data: { notifiedAt: at },
    });
  }
}
