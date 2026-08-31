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

  it('역방향 쌍은 dedup 하고 distance 를 detail 에 적는다', async () => {
    const repository = createRepositoryMock();
    repository.findNearestNeighbors.mockResolvedValue([
      { id: 1, relatedId: 2, distance: 0.01, occurredAt },
      { id: 2, relatedId: 1, distance: 0.01, occurredAt }, // 역쌍 — 제거되어야
    ]);
    const service = new KnowledgeLintService(repository as never);

    const { issues, duplicateTotal } = await service.lintIssues({
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
    expect(duplicateTotal).toBe(1);
  });

  // 임계값 판정은 조회 단계로 내려갔다 — service 가 그 값을 그대로 넘기는지가 계약이다.
  it('임계값을 조회에 그대로 넘긴다', async () => {
    const repository = createRepositoryMock();
    const service = new KnowledgeLintService(repository as never);

    await service.lintIssues({ duplicateMaxDistance: 0.001, limit: 50 });

    expect(repository.findNearestNeighbors).toHaveBeenCalledWith(
      expect.objectContaining({ maxDistance: 0.001 }),
    );
  });

  // 보고 상한에 잘려도 총 쌍 수는 잘리기 전 값이어야 한다 — 이 값이 화면의 "N건 중" 이 된다.
  it('보고 상한으로 목록을 자르되 duplicateTotal 은 전체 쌍 수를 낸다', async () => {
    const repository = createRepositoryMock();
    repository.findNearestNeighbors.mockResolvedValue(
      Array.from({ length: 7 }, (_unused, index) => ({
        id: index * 2 + 1,
        relatedId: index * 2 + 2,
        distance: 0,
        occurredAt,
      })),
    );
    const service = new KnowledgeLintService(repository as never);

    const { issues, duplicateTotal } = await service.lintIssues({
      duplicateMaxDistance: 0.001,
      limit: 3,
    });

    expect(
      issues.filter((issue) => issue.type === 'near_duplicate'),
    ).toHaveLength(3);
    expect(duplicateTotal).toBe(7);
  });

  // 스캔 상한에 걸리면 총계는 하한값이다 — 그 사실이 outcome 에 실려야 화면이 확정값처럼
  // 적지 않는다(로그만으로는 메시지를 보는 사람에게 닿지 않는다).
  it('스캔 상한에 도달하면 duplicateTotalTruncated 를 세운다', async () => {
    const repository = createRepositoryMock();
    repository.findNearestNeighbors.mockResolvedValue(
      Array.from({ length: 5_000 }, (_unused, index) => ({
        id: index * 2 + 1,
        relatedId: index * 2 + 2,
        distance: 0,
        occurredAt,
      })),
    );
    const service = new KnowledgeLintService(repository as never);

    const { duplicateTotal, duplicateTotalTruncated } =
      await service.lintIssues({ duplicateMaxDistance: 0.001, limit: 50 });

    expect(duplicateTotalTruncated).toBe(true);
    expect(duplicateTotal).toBe(5_000);
  });

  it('상한에 못 미치면 duplicateTotalTruncated 는 false', async () => {
    const repository = createRepositoryMock();
    repository.findNearestNeighbors.mockResolvedValue([
      { id: 1, relatedId: 2, distance: 0, occurredAt },
    ]);
    const service = new KnowledgeLintService(repository as never);

    const { duplicateTotalTruncated } = await service.lintIssues({
      duplicateMaxDistance: 0.001,
      limit: 50,
    });

    expect(duplicateTotalTruncated).toBe(false);
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
