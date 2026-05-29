import { PrismaService } from '../../prisma/prisma.service';
import { AgentRunStatus } from '../domain/agent-run.type';
import { AgentRunPrismaRepository } from './agent-run.prisma.repository';

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
