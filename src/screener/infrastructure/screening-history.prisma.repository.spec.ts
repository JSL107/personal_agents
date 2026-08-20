import { PrismaService } from '../../prisma/prisma.service';
import {
  SaveScreeningRunInput,
  ScreeningHistoryPrismaRepository,
} from './screening-history.prisma.repository';

interface TransactionSpies {
  findUnique: jest.Mock;
  upsert: jest.Mock;
  deleteMany: jest.Mock;
  createMany: jest.Mock;
}

const prismaWith = (
  existingRun: { id: number; agentRunId: number | null } | null,
): { prisma: PrismaService; spies: TransactionSpies } => {
  const spies: TransactionSpies = {
    findUnique: jest.fn().mockResolvedValue(existingRun),
    upsert: jest.fn().mockResolvedValue({ id: existingRun?.id ?? 11 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const transaction = {
    screeningRun: {
      findUnique: spies.findUnique,
      upsert: spies.upsert,
    },
    screeningRunItem: {
      deleteMany: spies.deleteMany,
      createMany: spies.createMany,
    },
  };
  return {
    spies,
    prisma: {
      $transaction: async (
        run: (client: typeof transaction) => Promise<unknown>,
      ): Promise<unknown> => await run(transaction),
    } as unknown as PrismaService,
  };
};

const input = (agentRunId: number | null): SaveScreeningRunInput => ({
  strategy: 'SWING',
  asOf: new Date('2026-08-19T00:00:00.000Z'),
  ruleVersion: 2,
  agentRunId,
  universeCount: 2_596,
  evaluatedCount: 2_595,
  staleCount: 1,
  passedCount: 106,
  items: [
    { tickerId: 1, rank: 1, score: 93.97, indicatorSnapshot: { close: 1_000 } },
  ],
});

describe('ScreeningHistoryPrismaRepository', () => {
  it('회차를 upsert하고 항목을 갈아 끼운다', async () => {
    const { prisma, spies } = prismaWith(null);
    const repository = new ScreeningHistoryPrismaRepository(prisma);

    await expect(repository.saveScreeningRun(input(55))).resolves.toEqual({
      saved: true,
      runId: 11,
      recordedCount: 1,
    });

    expect(spies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          strategy_asOf: {
            strategy: 'SWING',
            asOf: new Date('2026-08-19T00:00:00.000Z'),
          },
        },
        create: expect.objectContaining({ agentRunId: 55, passedCount: 106 }),
        update: expect.objectContaining({ agentRunId: 55 }),
      }),
    );
    // 옛 항목을 지우지 않으면 상한을 줄여 다시 돌린 회차에 지난 항목이 섞인다.
    expect(spies.deleteMany).toHaveBeenCalledWith({ where: { runId: 11 } });
    expect(spies.createMany).toHaveBeenCalledTimes(1);
  });

  it('운영 회차가 있으면 확인용 실행은 덮어쓰지 않고 이유를 돌려준다', async () => {
    const { prisma, spies } = prismaWith({ id: 9, agentRunId: 41 });
    const repository = new ScreeningHistoryPrismaRepository(prisma);

    await expect(repository.saveScreeningRun(input(null))).resolves.toEqual({
      saved: false,
      reason: 'OPERATIONAL_RUN_EXISTS',
      runId: 9,
    });

    // 상한이 다른 확인용 실행이 항목을 갈아버리면 그날 무엇을 보여줬는지가 사라진다.
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(spies.deleteMany).not.toHaveBeenCalled();
    expect(spies.createMany).not.toHaveBeenCalled();
  });

  it('운영 회차는 같은 기준일을 다시 돌려 정본을 갱신할 수 있다', async () => {
    const { prisma, spies } = prismaWith({ id: 9, agentRunId: 41 });
    const repository = new ScreeningHistoryPrismaRepository(prisma);

    await expect(repository.saveScreeningRun(input(77))).resolves.toEqual({
      saved: true,
      runId: 9,
      recordedCount: 1,
    });

    expect(spies.upsert).toHaveBeenCalledTimes(1);
    expect(spies.deleteMany).toHaveBeenCalledWith({ where: { runId: 9 } });
  });

  it('확인용 실행끼리는 서로 덮어쓴다', async () => {
    const { prisma, spies } = prismaWith({ id: 9, agentRunId: null });
    const repository = new ScreeningHistoryPrismaRepository(prisma);

    await expect(repository.saveScreeningRun(input(null))).resolves.toEqual({
      saved: true,
      runId: 9,
      recordedCount: 1,
    });

    expect(spies.upsert).toHaveBeenCalledTimes(1);
  });
});
