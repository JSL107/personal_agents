import { KnowledgeLintService } from './knowledge-lint.service';

function createRepositoryMock() {
  return {
    findNearestNeighbors: jest.fn().mockResolvedValue([]),
    findEmbeddingNull: jest.fn().mockResolvedValue([]),
  };
}

describe('KnowledgeLintService', () => {
  const occurredAt = new Date('2026-06-20T00:00:00Z');

  it('임계값 이내 이웃만 near_duplicate 로 잡고, 역방향 쌍은 dedup', async () => {
    const repository = createRepositoryMock();
    repository.findNearestNeighbors.mockResolvedValue([
      { id: 1, relatedId: 2, distance: 0.01, occurredAt },
      { id: 2, relatedId: 1, distance: 0.01, occurredAt }, // 역쌍 — 제거되어야
      { id: 3, relatedId: 4, distance: 0.5, occurredAt }, // 임계값 초과 — 제외
    ]);
    const service = new KnowledgeLintService(repository as never);

    const issues = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
    });

    const duplicates = issues.filter(
      (issue) => issue.type === 'near_duplicate',
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].episodeId).toBe(1);
    expect(duplicates[0].relatedId).toBe(2);
    expect(duplicates[0].detail).toContain('0.010');
  });

  it('embedding NULL 행을 embedding_null 이슈로 변환', async () => {
    const repository = createRepositoryMock();
    repository.findEmbeddingNull.mockResolvedValue([{ id: 9, occurredAt }]);
    const service = new KnowledgeLintService(repository as never);

    const issues = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
    });

    const nulls = issues.filter((issue) => issue.type === 'embedding_null');
    expect(nulls).toHaveLength(1);
    expect(nulls[0].episodeId).toBe(9);
  });

  it('이슈 없으면 빈 배열', async () => {
    const service = new KnowledgeLintService(createRepositoryMock() as never);

    const issues = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
    });

    expect(issues).toEqual([]);
  });
});
