import { MockEmbedder } from '../infrastructure/mock-embedder.adapter';
import { EpisodicMemoryService } from './episodic-memory.service';

function createRepositoryMock() {
  return {
    insert: jest.fn().mockResolvedValue(undefined),
    searchByVector: jest.fn().mockResolvedValue([]),
  };
}

describe('EpisodicMemoryService', () => {
  it('record: content를 임베딩해 repository.insert에 넘긴다', async () => {
    const repository = createRepositoryMock();
    const service = new EpisodicMemoryService(
      new MockEmbedder(384),
      repository as never,
    );

    await service.record({
      kind: 'agent_run',
      agentRunId: 7,
      agentType: 'PM',
      content: '오늘 plan: 결제 리팩토링',
      occurredAt: new Date('2026-06-18T00:00:00Z'),
    });

    expect(repository.insert).toHaveBeenCalledTimes(1);
    const inserted = repository.insert.mock.calls[0][0];
    expect(inserted.agentRunId).toBe(7);
    expect(inserted.embedding).toHaveLength(384);
  });

  it('record: repository 실패는 swallow(throw하지 않음 — 본 흐름 보호)', async () => {
    const repository = createRepositoryMock();
    repository.insert.mockRejectedValue(new Error('db down'));
    const service = new EpisodicMemoryService(
      new MockEmbedder(384),
      repository as never,
    );

    await expect(
      service.record({
        kind: 'agent_run',
        content: 'x',
        occurredAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it('onModuleDestroy: 기다리지 않고 던진 적재가 끝날 때까지 기다린다 — Prisma 연결이 닫히기 전에', async () => {
    const repository = createRepositoryMock();
    let finishInsert: () => void = () => undefined;
    repository.insert.mockReturnValue(
      new Promise<void>((resolve) => {
        finishInsert = resolve;
      }),
    );
    const service = new EpisodicMemoryService(
      new MockEmbedder(384),
      repository as never,
    );

    void service.record({
      kind: 'agent_run',
      content: '늦게 끝나는 적재',
      occurredAt: new Date(),
    });
    let destroyed = false;
    const destroy = service.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(repository.insert).toHaveBeenCalledTimes(1);
    expect(destroyed).toBe(false);

    finishInsert();
    await destroy;
    expect(destroyed).toBe(true);
  });

  it('onModuleDestroy: 동시에 걸린 적재가 여럿이면 먼저 끝난 것과 무관하게 전부 기다린다', async () => {
    const repository = createRepositoryMock();
    const finishers: Array<() => void> = [];
    repository.insert.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishers.push(resolve);
        }),
    );
    const service = new EpisodicMemoryService(
      new MockEmbedder(384),
      repository as never,
    );

    for (const content of ['첫 적재', '둘째 적재']) {
      void service.record({
        kind: 'agent_run',
        content,
        occurredAt: new Date(),
      });
    }
    let destroyed = false;
    const destroy = service.onModuleDestroy().then(() => {
      destroyed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(repository.insert).toHaveBeenCalledTimes(2);

    // 나중에 건 것이 먼저 끝나도 앞의 것이 남아 있으면 종료하지 않는다.
    finishers[1]();
    await new Promise((resolve) => setImmediate(resolve));
    expect(destroyed).toBe(false);

    finishers[0]();
    await destroy;
    expect(destroyed).toBe(true);
  });

  it('searchRelevant: distance→similarity 변환 + 최신 가중으로 정렬', async () => {
    const repository = createRepositoryMock();
    const now = Date.now();
    repository.searchByVector.mockResolvedValue([
      // 유사하지만 오래됨
      {
        id: 1,
        agentRunId: 1,
        distance: 0.1,
        occurredAt: new Date(now - 200 * 86400000),
      },
      // 약간 덜 유사하지만 최신
      { id: 2, agentRunId: 2, distance: 0.2, occurredAt: new Date(now) },
    ]);
    const service = new EpisodicMemoryService(
      new MockEmbedder(384),
      repository as never,
    );

    const hits = await service.searchRelevant({
      query: 'q',
      kind: 'agent_run',
      limit: 2,
    });

    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score); // 내림차순
    expect(hits.every((hit) => hit.score >= 0)).toBe(true);
  });

  it('searchRelevant: agentType/content 를 hit 에 통과시킨다', async () => {
    const repository = createRepositoryMock();
    repository.searchByVector.mockResolvedValue([
      {
        id: 1,
        agentRunId: 11,
        agentType: 'BE',
        content: '결제 모듈 리팩토링',
        distance: 0.1,
        occurredAt: new Date(),
      },
    ]);
    const service = new EpisodicMemoryService(
      new MockEmbedder(384),
      repository as never,
    );

    const hits = await service.searchRelevant({
      query: 'q',
      kind: 'agent_run',
      limit: 1,
    });

    expect(hits[0].agentType).toBe('BE');
    expect(hits[0].content).toBe('결제 모듈 리팩토링');
  });
});
