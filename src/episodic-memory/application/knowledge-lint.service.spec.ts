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

    const { issues } = await service.lintIssues({
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

    const { issues } = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
    });

    const nulls = issues.filter((issue) => issue.type === 'embedding_null');
    expect(nulls).toHaveLength(1);
    expect(nulls[0].episodeId).toBe(9);
  });

  it('이슈 없으면 빈 배열', async () => {
    const service = new KnowledgeLintService(createRepositoryMock() as never);

    const { issues } = await service.lintIssues({
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

    const outcome = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
      l4: L4,
    });

    const contradictions = outcome.issues.filter(
      (issue) => issue.type === 'contradiction',
    );
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].episodeId).toBe(1);
    expect(contradictions[0].relatedId).toBe(2);
    expect(contradictions[0].detail).toContain('결론 충돌');
    // 완주 실태 — 후보 1쌍을 전부 판정했다.
    expect(outcome.l4).toEqual({
      candidates: 1,
      judged: 1,
      abortedByQuota: false,
    });
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

    const outcome = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
      l4: L4,
    });

    expect(judge.judge).toHaveBeenCalledTimes(1); // 첫 쿼터 소진에서 break
    expect(
      outcome.issues.filter((issue) => issue.type === 'contradiction'),
    ).toHaveLength(0);
    // 여기가 핵심 — 이슈 0건이 "모순 없음" 이 아니라 "판정을 못 했다" 임을 실태로 드러낸다.
    // 이 값이 없으면 호출자가 "모순까지 점검했고 이상 없음" 이라고 알린다.
    expect(outcome.l4).toEqual({
      candidates: 2,
      judged: 0,
      abortedByQuota: true,
    });
  });

  it('L4 — 개별 judge 실패는 그 쌍만 건너뛰고 judged 로 부분 실패를 드러낸다', async () => {
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
        .mockRejectedValueOnce(new Error('judge 파싱 실패'))
        .mockResolvedValueOnce({ contradiction: false, reason: '' }),
    };
    const service = new KnowledgeLintService(
      repository as never,
      judge as never,
    );

    const outcome = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
      l4: L4,
    });

    // 쿼터가 아니므로 중단하지 않고 두 쌍을 다 시도했지만, 판정을 끝낸 것은 1쌍뿐이다.
    expect(judge.judge).toHaveBeenCalledTimes(2);
    expect(outcome.issues).toHaveLength(0);
    expect(outcome.l4).toEqual({
      candidates: 2,
      judged: 1,
      abortedByQuota: false,
    });
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

    const outcome = await service.lintIssues({
      duplicateMaxDistance: 0.05,
      limit: 50,
      l4: L4,
    });

    expect(
      outcome.issues.filter((issue) => issue.type === 'contradiction'),
    ).toHaveLength(0);
    expect(repository.findBandPairs).not.toHaveBeenCalled();
    // env 는 enabled=true 인데 judge 가 없어 실제로는 점검하지 않았다 → null 로 그 사실을 남긴다.
    // 이걸 "판정했고 0건" 과 섞으면 배선이 깨진 주간에도 "모순 점검 완료" 로 보고된다.
    expect(outcome.l4).toBeNull();
  });
});
