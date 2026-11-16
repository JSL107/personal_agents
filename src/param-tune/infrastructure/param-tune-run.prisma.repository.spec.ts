import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivateNewVersionKind } from '../../strategy-parameter/domain/strategy-parameter.type';
import {
  activateNewVersionWith,
  readParameterSnapshot,
} from '../../strategy-parameter/infrastructure/strategy-parameter.prisma.repository';
import {
  TUNE_EXCLUSION_DAYS,
  TuneDecision,
  TuneEvaluation,
  TuneRunStatus,
} from '../domain/param-tune.type';
import { ClaimKind } from '../domain/param-tune.type';
import { ParamTuneRunPrismaRepository } from './param-tune-run.prisma.repository';

jest.mock(
  '../../strategy-parameter/infrastructure/strategy-parameter.prisma.repository',
  () => ({
    ...jest.requireActual(
      '../../strategy-parameter/infrastructure/strategy-parameter.prisma.repository',
    ),
    activateNewVersionWith: jest.fn(),
    readParameterSnapshot: jest.fn(),
  }),
);

const MINUTE = 60_000;
const DAY = 86_400_000;
const decimal = (value: number) => ({ toNumber: () => value });

describe('ParamTuneRunPrismaRepository', () => {
  const parameterTuneRun = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  };
  const $transaction = jest.fn();
  const repository = new ParamTuneRunPrismaRepository({
    parameterTuneRun,
    $transaction,
  } as unknown as PrismaService);
  const mockedActivate = activateNewVersionWith as jest.Mock;
  const mockedReadSnapshot = readParameterSnapshot as jest.Mock;

  const now = new Date('2026-11-16T00:00:00.000Z');
  const input = {
    weekStart: '2026-11-16',
    strategy: 'SWING' as const,
    axis: 'EXIT_TAKE_PROFIT_PERCENT' as const,
    now,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    // 트랜잭션 클라이언트 tx 를 넘겨 콜백을 돌리고, 콜백이 던지면 그대로 reject 한다(=롤백).
    $transaction.mockImplementation(async (callback) =>
      callback({ parameterTuneRun, tx: true }),
    );
  });

  describe('claim', () => {
    it('빈 주면 만들고 CLAIMED', async () => {
      parameterTuneRun.findUnique.mockResolvedValue(null);
      parameterTuneRun.create.mockResolvedValue({ id: 7 });

      const result = await repository.claim(input);

      expect(result).toEqual({
        kind: ClaimKind.CLAIMED,
        runId: 7,
        attemptToken: expect.any(String),
      });
      const data = parameterTuneRun.create.mock.calls[0][0].data;
      expect(data.weekStart).toEqual(new Date('2026-11-16T00:00:00.000Z'));
      expect(data).toMatchObject({
        status: TuneRunStatus.RUNNING,
        startedAt: now,
      });
    });

    it('동시 create 의 P2002 는 재조회해 ALREADY_RUNNING', async () => {
      parameterTuneRun.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 9 });
      parameterTuneRun.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      expect(await repository.claim(input)).toEqual({
        kind: ClaimKind.ALREADY_RUNNING,
        runId: 9,
      });
    });

    it('RUNNING 30분 전이면 ALREADY_RUNNING', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 3,
        status: TuneRunStatus.RUNNING,
        attemptToken: 'old',
        startedAt: new Date(now.getTime() - 30 * MINUTE),
      });

      expect(await repository.claim(input)).toEqual({
        kind: ClaimKind.ALREADY_RUNNING,
        runId: 3,
      });
      expect(parameterTuneRun.updateMany).not.toHaveBeenCalled();
    });

    it('RUNNING 100분 전이면 옛 토큰 조건으로 재선점', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 3,
        status: TuneRunStatus.RUNNING,
        attemptToken: 'old',
        startedAt: new Date(now.getTime() - 100 * MINUTE),
      });
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.claim(input);

      expect(result).toMatchObject({ kind: ClaimKind.CLAIMED, runId: 3 });
      const call = parameterTuneRun.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: 3,
        attemptToken: 'old',
        status: TuneRunStatus.RUNNING,
        startedAt: new Date(now.getTime() - 100 * MINUTE),
      });
      expect(call.data).toMatchObject({
        status: TuneRunStatus.RUNNING,
        startedAt: now,
        failureReason: null,
        notifiedAt: null,
      });
      expect(call.data.attemptToken).not.toBe('old');
    });

    it('FAILED 면 재선점', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 4,
        status: TuneRunStatus.FAILED,
        attemptToken: 'old',
        startedAt: new Date(now.getTime() - MINUTE),
      });
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      expect(await repository.claim(input)).toMatchObject({
        kind: ClaimKind.CLAIMED,
        runId: 4,
      });
    });

    it('발송된 FAILED 행을 재선점하면 notifiedAt 을 비운다', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 4,
        status: TuneRunStatus.FAILED,
        attemptToken: 'old',
        startedAt: new Date(now.getTime() - MINUTE),
        notifiedAt: new Date(now.getTime() - MINUTE),
      });
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      await repository.claim(input);

      expect(
        parameterTuneRun.updateMany.mock.calls[0][0].data.notifiedAt,
      ).toBeNull();
    });

    it('재선점 update 가 count 0 이면 ALREADY_RUNNING', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 4,
        status: TuneRunStatus.FAILED,
        attemptToken: 'old',
        startedAt: now,
      });
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.claim(input)).toEqual({
        kind: ClaimKind.ALREADY_RUNNING,
        runId: 4,
      });
    });

    it('읽은 뒤 옛 프로세스가 같은 토큰으로 끝냈으면 재선점하지 않는다', async () => {
      const startedAt = new Date(now.getTime() - 100 * MINUTE);
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 3,
        status: TuneRunStatus.RUNNING,
        attemptToken: 'old',
        startedAt,
      });
      // 조건의 status: RUNNING 이 이미 DONE 이 된 행과 맞지 않아 count 0.
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.claim(input)).toEqual({
        kind: ClaimKind.ALREADY_RUNNING,
        runId: 3,
      });
      expect(parameterTuneRun.updateMany.mock.calls[0][0].where).toMatchObject({
        status: TuneRunStatus.RUNNING,
        startedAt,
      });
    });

    it.each(['DONE', 'SKIPPED_PROBATION'])(
      '%s 면 ALREADY_DONE',
      async (status) => {
        parameterTuneRun.findUnique.mockResolvedValue({
          id: 5,
          status,
          attemptToken: 'old',
          startedAt: now,
        });

        expect(await repository.claim(input)).toEqual({
          kind: ClaimKind.ALREADY_DONE,
          runId: 5,
        });
      },
    );
  });

  describe('finish / markFailed', () => {
    it('finish 는 RUNNING + 토큰 조건이고 count 1 이면 true', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      const ok = await repository.finish({
        runId: 1,
        attemptToken: 't',
        patch: { status: TuneRunStatus.DONE, candidateValue: 5 },
      });

      expect(ok).toBe(true);
      expect(parameterTuneRun.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: TuneRunStatus.RUNNING, attemptToken: 't' },
        data: { status: TuneRunStatus.DONE, candidateValue: 5 },
      });
    });

    it('다른 토큰이면 count 0 → false', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      expect(
        await repository.finish({
          runId: 1,
          attemptToken: 'stale',
          patch: { status: TuneRunStatus.DONE },
        }),
      ).toBe(false);
    });

    it('markFailed 도 같은 조건', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      expect(
        await repository.markFailed({
          runId: 1,
          attemptToken: 't',
          reason: 'boom',
        }),
      ).toBe(true);
      expect(parameterTuneRun.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: TuneRunStatus.RUNNING, attemptToken: 't' },
        data: { status: TuneRunStatus.FAILED, failureReason: 'boom' },
      });
    });
  });

  describe('commitAdoption / commitRollback', () => {
    const activation = {
      strategy: 'SWING' as const,
      name: 'EXIT_TAKE_PROFIT_PERCENT' as const,
      expectedSnapshot: [],
      value: 15,
      reason: 'r',
      agentRunId: null,
    };
    const activated = {
      kind: ActivateNewVersionKind.ACTIVATED,
      parameterId: 21,
      version: 2,
    };

    it('commitAdoption 은 활성화와 회차 기록을 한 Serializable 트랜잭션에서 쓴다', async () => {
      mockedActivate.mockResolvedValue(activated);
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.commitAdoption({
        runId: 7,
        attemptToken: 't',
        activation,
        patch: {
          status: TuneRunStatus.DONE,
          decision: TuneDecision.APPLIED,
          candidateValue: 15,
        },
      });

      expect(result).toEqual(activated);
      expect($transaction).toHaveBeenCalledTimes(1);
      expect($transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      const tx = mockedActivate.mock.calls[0][0].tx;
      expect(tx).toMatchObject({ tx: true });
      expect(mockedActivate.mock.calls[0][0].input).toBe(activation);
      const call = parameterTuneRun.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: 7,
        status: TuneRunStatus.RUNNING,
        attemptToken: 't',
      });
      expect(call.data).toMatchObject({
        status: TuneRunStatus.DONE,
        decision: TuneDecision.APPLIED,
        candidateValue: 15,
        appliedParameterId: 21,
      });
      expect(call.data.appliedAt).toBeInstanceOf(Date);
    });

    it('commitAdoption 은 토큰을 잃었으면 트랜잭션 콜백이 던져 활성화까지 되돌린다', async () => {
      mockedActivate.mockResolvedValue(activated);
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.commitAdoption({
          runId: 7,
          attemptToken: 'stale',
          activation,
          patch: { status: TuneRunStatus.DONE },
        }),
      ).rejects.toThrow(/토큰을 잃어/);
      expect(mockedActivate).toHaveBeenCalledTimes(1);
    });

    it('commitAdoption 은 CONFLICT 면 회차를 쓰지 않는다', async () => {
      const conflict = { kind: ActivateNewVersionKind.CONFLICT, actual: [] };
      mockedActivate.mockResolvedValue(conflict);

      expect(
        await repository.commitAdoption({
          runId: 7,
          attemptToken: 't',
          activation,
          patch: { status: TuneRunStatus.DONE },
        }),
      ).toEqual(conflict);
      expect(parameterTuneRun.updateMany).not.toHaveBeenCalled();
    });

    it('직렬화 실패(P2034)는 CONFLICT 와 최신 스냅샷으로 바꾼다', async () => {
      $transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('serialize', {
          code: 'P2034',
          clientVersion: 'x',
        }),
      );
      mockedReadSnapshot.mockResolvedValue([{ name: 'X' }]);

      expect(
        await repository.commitRollback({
          runId: 3,
          activation,
          detail: {},
        }),
      ).toEqual({
        kind: ActivateNewVersionKind.CONFLICT,
        actual: [{ name: 'X' }],
      });
      expect(mockedReadSnapshot.mock.calls[0][0].strategy).toBe('SWING');
    });

    it('commitRollback 은 활성화와 ROLLBACK 확정을 한 트랜잭션에서 쓴다', async () => {
      mockedActivate.mockResolvedValue(activated);
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      await repository.commitRollback({
        runId: 3,
        activation,
        detail: { a: 1 },
      });

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(mockedActivate.mock.calls[0][0].tx).toMatchObject({ tx: true });
      const call = parameterTuneRun.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 3, evaluatedAt: null });
      expect(call.data).toMatchObject({
        evaluation: TuneEvaluation.ROLLBACK,
        evaluationDetail: { a: 1 },
        notifiedAt: null,
      });
      expect(call.data.evaluatedAt).toBeInstanceOf(Date);
    });

    it('commitRollback 은 이미 평가된 행이면 던져 활성화까지 되돌린다', async () => {
      mockedActivate.mockResolvedValue(activated);
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.commitRollback({ runId: 3, activation, detail: {} }),
      ).rejects.toThrow(/이미 평가된/);
    });
  });

  describe('settleEvaluation', () => {
    it('evaluatedAt null 조건이고 notifiedAt 을 비워 다시 알린다', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      const ok = await repository.settleEvaluation({
        runId: 2,
        evaluation: TuneEvaluation.ROLLBACK,
        detail: { a: 1 },
      });

      expect(ok).toBe(true);
      const call = parameterTuneRun.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 2, evaluatedAt: null });
      expect(call.data).toMatchObject({
        evaluation: TuneEvaluation.ROLLBACK,
        evaluationDetail: { a: 1 },
        notifiedAt: null,
      });
      expect(call.data.evaluatedAt).toBeInstanceOf(Date);
    });

    it('두 번째 호출은 count 0 → false', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      expect(
        await repository.settleEvaluation({
          runId: 2,
          evaluation: TuneEvaluation.KEEP,
          detail: {},
        }),
      ).toBe(false);
    });
  });

  describe('findExcludedValues', () => {
    it('56일 경계를 gte 로 걸러 후보 값을 돌려준다', async () => {
      parameterTuneRun.findMany.mockResolvedValue([
        { candidateValue: decimal(10) },
        { candidateValue: null },
      ]);

      const values = await repository.findExcludedValues(input);

      expect(values).toEqual([10]);
      expect(parameterTuneRun.findMany.mock.calls[0][0].where).toEqual({
        strategy: 'SWING',
        axis: 'EXIT_TAKE_PROFIT_PERCENT',
        evaluation: TuneEvaluation.ROLLBACK,
        evaluatedAt: {
          gte: new Date(now.getTime() - TUNE_EXCLUSION_DAYS * DAY),
        },
      });
    });
  });

  describe('probation 조회', () => {
    const row = {
      id: 8,
      axis: 'EXIT_STOP_LOSS_PERCENT',
      previousValue: decimal(-5),
      candidateValue: decimal(-3),
      previousParameterId: 1,
      appliedParameterId: 2,
      appliedAt: new Date('2026-11-17T00:00:00.000Z'),
      createdAt: new Date('2026-11-16T01:00:00.000Z'),
    };

    it('findOpenProbation 은 APPLIED·미평가 최신 1건, startedOn=appliedAt', async () => {
      parameterTuneRun.findFirst.mockResolvedValue(row);

      expect(await repository.findOpenProbation('SWING')).toEqual({
        runId: 8,
        axis: 'EXIT_STOP_LOSS_PERCENT',
        previousValue: -5,
        candidateValue: -3,
        previousParameterId: 1,
        appliedParameterId: 2,
        startedOn: row.appliedAt,
      });
      expect(parameterTuneRun.findFirst.mock.calls[0][0]).toMatchObject({
        where: {
          strategy: 'SWING',
          decision: TuneDecision.APPLIED,
          evaluation: null,
        },
        orderBy: { id: 'desc' },
      });
    });

    it('없으면 null', async () => {
      parameterTuneRun.findFirst.mockResolvedValue(null);
      expect(await repository.findOpenProbation('SWING')).toBeNull();
    });

    it('findOpenProbation 은 previousValue 가 null 이면 reject', async () => {
      parameterTuneRun.findFirst.mockResolvedValue({
        ...row,
        previousValue: null,
      });

      await expect(repository.findOpenProbation('SWING')).rejects.toThrow(
        /id=8.*previousValue/,
      );
    });

    it('findWouldApplyUnevaluated 는 candidateValue 가 null 이면 reject', async () => {
      parameterTuneRun.findMany.mockResolvedValue([
        { ...row, candidateValue: null },
      ]);

      await expect(
        repository.findWouldApplyUnevaluated('SWING'),
      ).rejects.toThrow(/id=8.*candidateValue/);
    });

    it('findWouldApplyUnevaluated 는 parameterId null, startedOn=createdAt', async () => {
      parameterTuneRun.findMany.mockResolvedValue([row]);

      const [first] = await repository.findWouldApplyUnevaluated('SWING');

      expect(first).toMatchObject({
        previousParameterId: null,
        appliedParameterId: null,
        startedOn: row.createdAt,
      });
      expect(parameterTuneRun.findMany.mock.calls[0][0].where).toEqual({
        strategy: 'SWING',
        decision: TuneDecision.WOULD_APPLY,
        evaluation: null,
      });
    });
  });

  describe('findVerdictByKey', () => {
    it('DONE 이고 verdict 가 있는 최신 행', async () => {
      parameterTuneRun.findFirst.mockResolvedValue({
        id: 6,
        verdict: { v: 1 },
      });

      expect(
        await repository.findVerdictByKey({
          strategy: 'SWING',
          verdictKey: 'k',
        }),
      ).toEqual({
        runId: 6,
        verdict: { v: 1 },
      });
      expect(parameterTuneRun.findFirst.mock.calls[0][0]).toMatchObject({
        where: {
          strategy: 'SWING',
          verdictKey: 'k',
          status: TuneRunStatus.DONE,
          verdict: { not: Prisma.DbNull },
        },
        orderBy: { id: 'desc' },
      });
    });

    it('없으면 null', async () => {
      parameterTuneRun.findFirst.mockResolvedValue(null);
      expect(
        await repository.findVerdictByKey({
          strategy: 'LONG_TERM',
          verdictKey: 'k',
        }),
      ).toBeNull();
    });
  });

  describe('hasAppliedFromWindow', () => {
    it('같은 축·APPLIED·창 접두사로 찾고 있으면 true', async () => {
      parameterTuneRun.findFirst.mockResolvedValue({ id: 4 });

      expect(
        await repository.hasAppliedFromWindow({
          strategy: 'SWING',
          axis: 'EXIT_STOP_LOSS_PERCENT',
          windowEnd: '2026-09-30',
        }),
      ).toBe(true);
      expect(parameterTuneRun.findFirst.mock.calls[0][0].where).toEqual({
        strategy: 'SWING',
        axis: 'EXIT_STOP_LOSS_PERCENT',
        decision: TuneDecision.APPLIED,
        verdictKey: {
          startsWith: 'SWING|EXIT_STOP_LOSS_PERCENT|2026-09-30|',
        },
      });
    });

    it('없으면 false', async () => {
      parameterTuneRun.findFirst.mockResolvedValue(null);

      expect(
        await repository.hasAppliedFromWindow({
          strategy: 'SWING',
          axis: 'EXIT_STOP_LOSS_PERCENT',
          windowEnd: '2026-09-30',
        }),
      ).toBe(false);
    });
  });

  describe('알림', () => {
    it('findUnnotified 는 미알림 + 종결 상태, id 순', async () => {
      parameterTuneRun.findMany.mockResolvedValue([]);

      await repository.findUnnotified();

      expect(parameterTuneRun.findMany).toHaveBeenCalledWith({
        where: {
          notifiedAt: null,
          status: { in: ['DONE', 'FAILED', 'SKIPPED_PROBATION'] },
        },
        orderBy: { id: 'asc' },
      });
    });

    it('markNotified 는 id in', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 2 });
      const at = new Date();

      await repository.markNotified({ ids: [1, 2], at });

      expect(parameterTuneRun.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { notifiedAt: at },
      });
    });
  });

  describe('countAppliedBetween', () => {
    it('반영 시각이나 롤백 평가 시각이 구간 안인 행을 한 번씩 센다', async () => {
      parameterTuneRun.count.mockResolvedValue(4);
      const since = new Date('2026-11-09T00:00:00.000Z');
      const until = new Date('2026-11-16T00:00:00.000Z');

      expect(await repository.countAppliedBetween({ since, until })).toBe(4);
      expect(parameterTuneRun.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { appliedAt: { gte: since, lt: until } },
            {
              evaluation: TuneEvaluation.ROLLBACK,
              evaluatedAt: { gte: since, lt: until },
            },
          ],
        },
      });
    });
  });
});
