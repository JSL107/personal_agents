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
});
