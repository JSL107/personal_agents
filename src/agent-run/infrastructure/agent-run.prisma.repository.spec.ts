import { PrismaService } from '../../prisma/prisma.service';
import { AgentRunStatus } from '../domain/agent-run.type';
import { AgentRunPrismaRepository } from './agent-run.prisma.repository';

describe('AgentRunPrismaRepository.sweepZombies', () => {
  it('cutoff 이전 IN_PROGRESS 를 FAILED 로 updateMany 하고 count 반환', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-21T00:00:00.000Z'));
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prismaMock = {
      agentRun: { updateMany },
    } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.sweepZombies({ olderThanMinutes: 30 });

    expect(result).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: 'IN_PROGRESS',
        startedAt: { lt: new Date('2026-07-20T23:30:00.000Z') },
      },
      data: {
        status: 'FAILED',
        output: { error: 'swept: stale IN_PROGRESS' },
        endedAt: new Date('2026-07-21T00:00:00.000Z'),
      },
    });
    jest.useRealTimers();
  });
});

describe('AgentRunPrismaRepository Ops Supervisor 집계', () => {
  it('aggregateRetryCounts: FAILURE_REPLAY 트리거를 agentType 별로 센다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ agentType: 'PM', _count: { _all: 2 } }]);
    const prismaMock = { agentRun: { groupBy } } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.aggregateRetryCounts({ sinceDays: 30 });

    expect(result).toEqual([{ agentType: 'PM', retries: 2 }]);
    expect(groupBy.mock.calls[0][0].where.triggerType).toBe('FAILURE_REPLAY');
  });

  it('aggregateSweptCounts: swept 마커가 붙은 FAILED 를 센다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ agentType: 'BE', _count: { _all: 1 } }]);
    const prismaMock = { agentRun: { groupBy } } as unknown as PrismaService;
    const repository = new AgentRunPrismaRepository(prismaMock);

    const result = await repository.aggregateSweptCounts({ sinceDays: 30 });

    expect(result).toEqual([{ agentType: 'BE', swept: 1 }]);
    const where = groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('FAILED');
    expect(where.output).toEqual({
      path: ['error'],
      string_starts_with: 'swept:',
    });
  });
});

// V3 비전 봇 쪼개기 step 8 (commit 2c236d7) 의 updateParentId 단위 검증.
// repository 의 다른 method 들은 다른 의존성 (raw SQL / aggregate / FTS) 이 많아 spec 분리 가치 낮음 —
// updateParentId 는 단순 update 라 mock 으로 명확히 검증 가능.
describe('AgentRunPrismaRepository.updateParentId', () => {
  const buildRepository = (): {
    repo: AgentRunPrismaRepository;
    update: jest.Mock;
  } => {
    const update = jest.fn().mockResolvedValue(undefined);
    const prismaMock = {
      agentRun: { update },
    } as unknown as PrismaService;
    return { repo: new AgentRunPrismaRepository(prismaMock), update };
  };

  it('주어진 id 의 row 에 parentId 만 update — where/data 정확히 매핑', async () => {
    const { repo, update } = buildRepository();

    await repo.updateParentId({ id: 42, parentId: 7 });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { parentId: 7 },
    });
  });

  it('prisma update 가 reject 하면 그대로 propagate (manager 가 try/catch 로 graceful 처리)', async () => {
    const { repo, update } = buildRepository();
    const dbError = new Error('connection lost');
    update.mockRejectedValueOnce(dbError);

    await expect(repo.updateParentId({ id: 1, parentId: 2 })).rejects.toBe(
      dbError,
    );
  });
});

describe('AgentRunPrismaRepository.findRecentSucceededRuns', () => {
  const buildRepository = (): {
    repository: AgentRunPrismaRepository;
    findMany: jest.Mock;
  } => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prismaMock = {
      agentRun: { findMany },
    } as unknown as PrismaService;
    return { repository: new AgentRunPrismaRepository(prismaMock), findMany };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T16:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sinceDays=1 이면 오늘 KST 00:00 이상으로 조회한다', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findRecentSucceededRuns({
      agentType: 'WORK_REVIEWER' as never,
      sinceDays: 1,
      limit: 5,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endedAt: { gte: new Date('2026-07-07T15:00:00.000Z') },
        }),
      }),
    );
  });

  it('sinceDays=7 이면 최근 7 KST 캘린더일의 시작으로 조회한다', async () => {
    const { repository, findMany } = buildRepository();

    await repository.findRecentSucceededRuns({
      agentType: 'PO_EVAL' as never,
      sinceDays: 7,
      limit: 5,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endedAt: { gte: new Date('2026-07-01T15:00:00.000Z') },
        }),
      }),
    );
  });
});

describe('AgentRunPrismaRepository.findChainFromRoot — V3 chain audit walk', () => {
  const buildRepository = (
    queryResult: Array<{
      id: number;
      parent_id: number | null;
      agent_type: string;
      status: string;
      started_at: Date;
      ended_at: Date | null;
      depth: number;
    }>,
  ): { repo: AgentRunPrismaRepository; queryRaw: jest.Mock } => {
    const queryRaw = jest.fn().mockResolvedValue(queryResult);
    const prismaMock = { $queryRaw: queryRaw } as unknown as PrismaService;
    return { repo: new AgentRunPrismaRepository(prismaMock), queryRaw };
  };

  it('recursive CTE 결과를 AgentRunChainNode (camelCase + AgentRunStatus enum) 으로 매핑', async () => {
    const startedAt = new Date('2026-05-28T10:00:00Z');
    const endedAt = new Date('2026-05-28T10:00:30Z');
    const { repo, queryRaw } = buildRepository([
      {
        id: 100,
        parent_id: null,
        agent_type: 'PM',
        status: 'SUCCEEDED',
        started_at: startedAt,
        ended_at: endedAt,
        depth: 0,
      },
      {
        id: 101,
        parent_id: 100,
        agent_type: 'CTO',
        status: 'SUCCEEDED',
        started_at: startedAt,
        ended_at: endedAt,
        depth: 1,
      },
    ]);

    const result = await repo.findChainFromRoot({
      rootRunId: 100,
      maxDepth: 16,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: 100,
        parentId: null,
        agentType: 'PM',
        status: AgentRunStatus.SUCCEEDED,
        startedAt,
        endedAt,
        depth: 0,
      },
      {
        id: 101,
        parentId: 100,
        agentType: 'CTO',
        status: AgentRunStatus.SUCCEEDED,
        startedAt,
        endedAt,
        depth: 1,
      },
    ]);
  });

  it('빈 결과 (root 존재 X) 도 graceful — 빈 배열 그대로 반환', async () => {
    const { repo } = buildRepository([]);

    await expect(
      repo.findChainFromRoot({ rootRunId: 999, maxDepth: 16 }),
    ).resolves.toEqual([]);
  });

  it('FAILED status 도 AgentRunStatus enum 으로 매핑 (chain 안 일부 실패 케이스)', async () => {
    const startedAt = new Date('2026-05-28T10:00:00Z');
    const { repo } = buildRepository([
      {
        id: 1,
        parent_id: null,
        agent_type: 'PM',
        status: 'SUCCEEDED',
        started_at: startedAt,
        ended_at: startedAt,
        depth: 0,
      },
      {
        id: 2,
        parent_id: 1,
        agent_type: 'CTO',
        status: 'FAILED',
        started_at: startedAt,
        ended_at: startedAt,
        depth: 1,
      },
    ]);

    const result = await repo.findChainFromRoot({
      rootRunId: 1,
      maxDepth: 16,
    });

    expect(result[1].status).toBe(AgentRunStatus.FAILED);
  });
});
