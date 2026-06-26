import { CodexQuotaExceededException } from '../../model-router/infrastructure/codex-cli.provider';
import { KnowledgeLintService } from './knowledge-lint.service';

function createRepositoryMock() {
  return {
    findNearestNeighbors: jest.fn().mockResolvedValue([]),
    findEmbeddingNull: jest.fn().mockResolvedValue([]),
    findBandPairs: jest.fn().mockResolvedValue([]),
  };
}

const L4 = {
  enabled: true,
  maxPairs: 5,
  minDistance: 0.05,
  maxDistance: 0.15,
} as const;

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

  it('L4 — contradiction=true 쌍을 contradiction 이슈로 (judge 주입)', async () => {
    const repository = createRepositoryMock();
    repository.findBandPairs.mockResolvedValue([
      {
        idA: 1,
        idB: 2,
        distance: 0.1,
        contentA: 'x',
        contentB: 'y',
        occurredAt,
      },
    ]);
    const judge = {
      judge: jest
        .fn()
        .mockResolvedValue({ contradiction: true, reason: '결론 충돌' }),
    };
    const service = new KnowledgeLintService(
      repository as never,
      judge as never,
    );

    const issues = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
      l4: L4,
    });

    const contradictions = issues.filter(
      (issue) => issue.type === 'contradiction',
    );
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].episodeId).toBe(1);
    expect(contradictions[0].relatedId).toBe(2);
    expect(contradictions[0].detail).toContain('결론 충돌');
  });

  it('L4 — 쿼터 소진 시 남은 쌍 판정 중단(circuit break)', async () => {
    const repository = createRepositoryMock();
    repository.findBandPairs.mockResolvedValue([
      {
        idA: 1,
        idB: 2,
        distance: 0.1,
        contentA: 'x',
        contentB: 'y',
        occurredAt,
      },
      {
        idA: 3,
        idB: 4,
        distance: 0.11,
        contentA: 'p',
        contentB: 'q',
        occurredAt,
      },
    ]);
    const judge = {
      judge: jest
        .fn()
        .mockRejectedValue(new CodexQuotaExceededException('Jun 30')),
    };
    const service = new KnowledgeLintService(
      repository as never,
      judge as never,
    );

    const issues = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
      l4: L4,
    });

    expect(judge.judge).toHaveBeenCalledTimes(1); // 첫 쿼터 소진에서 break
    expect(
      issues.filter((issue) => issue.type === 'contradiction'),
    ).toHaveLength(0);
  });

  it('L4 — judge 미주입이면 contradiction skip (조회도 안 함)', async () => {
    const repository = createRepositoryMock();
    repository.findBandPairs.mockResolvedValue([
      {
        idA: 1,
        idB: 2,
        distance: 0.1,
        contentA: 'x',
        contentB: 'y',
        occurredAt,
      },
    ]);
    const service = new KnowledgeLintService(repository as never); // judge 없음

    const issues = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
      l4: L4,
    });

    expect(
      issues.filter((issue) => issue.type === 'contradiction'),
    ).toHaveLength(0);
    expect(repository.findBandPairs).not.toHaveBeenCalled();
  });
});
