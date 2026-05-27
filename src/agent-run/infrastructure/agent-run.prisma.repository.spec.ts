import { PrismaService } from '../../prisma/prisma.service';
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
