import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { TUNE_EXCLUSION_DAYS } from '../domain/param-tune.type';
import { ParamTuneRunPrismaRepository } from './param-tune-run.prisma.repository';

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
  const repository = new ParamTuneRunPrismaRepository({
    parameterTuneRun,
  } as unknown as PrismaService);

  const now = new Date('2026-11-16T00:00:00.000Z');
  const input = {
    weekStart: '2026-11-16',
    strategy: 'SWING' as const,
    axis: 'EXIT_TAKE_PROFIT_PERCENT' as const,
    now,
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('claim', () => {
    it('빈 주면 만들고 CLAIMED', async () => {
      parameterTuneRun.findUnique.mockResolvedValue(null);
      parameterTuneRun.create.mockResolvedValue({ id: 7 });

      const result = await repository.claim(input);

      expect(result).toEqual({
        kind: 'CLAIMED',
        runId: 7,
        attemptToken: expect.any(String),
      });
      const data = parameterTuneRun.create.mock.calls[0][0].data;
      expect(data.weekStart).toEqual(new Date('2026-11-16T00:00:00.000Z'));
      expect(data).toMatchObject({ status: 'RUNNING', startedAt: now });
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
        kind: 'ALREADY_RUNNING',
        runId: 9,
      });
    });

    it('RUNNING 30분 전이면 ALREADY_RUNNING', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 3,
        status: 'RUNNING',
        attemptToken: 'old',
        startedAt: new Date(now.getTime() - 30 * MINUTE),
      });

      expect(await repository.claim(input)).toEqual({
        kind: 'ALREADY_RUNNING',
        runId: 3,
      });
      expect(parameterTuneRun.updateMany).not.toHaveBeenCalled();
    });

    it('RUNNING 100분 전이면 옛 토큰 조건으로 재선점', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 3,
        status: 'RUNNING',
        attemptToken: 'old',
        startedAt: new Date(now.getTime() - 100 * MINUTE),
      });
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.claim(input);

      expect(result).toMatchObject({ kind: 'CLAIMED', runId: 3 });
      const call = parameterTuneRun.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 3, attemptToken: 'old' });
      expect(call.data).toMatchObject({
        status: 'RUNNING',
        startedAt: now,
        failureReason: null,
      });
      expect(call.data.attemptToken).not.toBe('old');
    });

    it('FAILED 면 재선점', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 4,
        status: 'FAILED',
        attemptToken: 'old',
        startedAt: new Date(now.getTime() - MINUTE),
      });
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      expect(await repository.claim(input)).toMatchObject({
        kind: 'CLAIMED',
        runId: 4,
      });
    });

    it('재선점 update 가 count 0 이면 ALREADY_RUNNING', async () => {
      parameterTuneRun.findUnique.mockResolvedValue({
        id: 4,
        status: 'FAILED',
        attemptToken: 'old',
        startedAt: now,
      });
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.claim(input)).toEqual({
        kind: 'ALREADY_RUNNING',
        runId: 4,
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
          kind: 'ALREADY_DONE',
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
        patch: { status: 'DONE', candidateValue: 5 },
      });

      expect(ok).toBe(true);
      expect(parameterTuneRun.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'RUNNING', attemptToken: 't' },
        data: { status: 'DONE', candidateValue: 5 },
      });
    });

    it('다른 토큰이면 count 0 → false', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 0 });

      expect(
        await repository.finish({
          runId: 1,
          attemptToken: 'stale',
          patch: { status: 'DONE' },
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
        where: { id: 1, status: 'RUNNING', attemptToken: 't' },
        data: { status: 'FAILED', failureReason: 'boom' },
      });
    });
  });

  describe('settleEvaluation', () => {
    it('evaluatedAt null 조건이고 notifiedAt 을 비워 다시 알린다', async () => {
      parameterTuneRun.updateMany.mockResolvedValue({ count: 1 });

      const ok = await repository.settleEvaluation({
        runId: 2,
        evaluation: 'ROLLBACK',
        detail: { a: 1 },
      });

      expect(ok).toBe(true);
      const call = parameterTuneRun.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 2, evaluatedAt: null });
      expect(call.data).toMatchObject({
        evaluation: 'ROLLBACK',
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
          evaluation: 'KEEP',
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
        evaluation: 'ROLLBACK',
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
        where: { strategy: 'SWING', decision: 'APPLIED', evaluation: null },
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
        decision: 'WOULD_APPLY',
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

      expect(await repository.findVerdictByKey('k')).toEqual({
        runId: 6,
        verdict: { v: 1 },
      });
      expect(parameterTuneRun.findFirst.mock.calls[0][0]).toMatchObject({
        where: {
          verdictKey: 'k',
          status: 'DONE',
          verdict: { not: Prisma.DbNull },
        },
        orderBy: { id: 'desc' },
      });
    });

    it('없으면 null', async () => {
      parameterTuneRun.findFirst.mockResolvedValue(null);
      expect(await repository.findVerdictByKey('k')).toBeNull();
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

      await repository.markNotified([1, 2], at);

      expect(parameterTuneRun.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { notifiedAt: at },
      });
    });
  });

  describe('countAppliedSince', () => {
    it('반영 시각이나 롤백 평가 시각이 구간 안인 행을 한 번씩 센다', async () => {
      parameterTuneRun.count.mockResolvedValue(4);
      const since = new Date('2026-11-09T00:00:00.000Z');

      expect(await repository.countAppliedSince(since)).toBe(4);
      expect(parameterTuneRun.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { appliedAt: { gte: since } },
            { evaluation: 'ROLLBACK', evaluatedAt: { gte: since } },
          ],
        },
      });
    });
  });
});
