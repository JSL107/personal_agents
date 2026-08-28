import { FetchPostingDetailUsecase } from './fetch-posting-detail.usecase';

const stored = (override: Record<string, unknown> = {}) => {
  return {
    id: 1,
    source: 'jumpit',
    sourceId: '100',
    company: '토스',
    title: '백엔드 개발자',
    detailUrl: 'https://example.test/1',
    skillTags: ['Java'],
    rawSkillTags: ['Java'],
    minYears: 3,
    maxYears: 7,
    experienceLevel: 'mid',
    locations: ['서울'],
    normalizedKey: 'toss|백엔드개발자',
    jdText: null,
    matchScore: 80,
    ...override,
  };
};

const stubRepository = (targets: unknown[]) => {
  return {
    findDetailTargets: jest.fn(async () => targets),
    saveDetail: jest.fn(async () => undefined),
    upsertMany: jest.fn(),
    findScoringTargets: jest.fn(),
    saveScore: jest.fn(),
    findNotifiable: jest.fn(),
    claimForNotification: jest.fn(),
    findGapCandidates: jest.fn(),
    saveGapAgentRunId: jest.fn(),
  };
};

const detailSource = (source: string) => {
  return {
    source,
    fetchList: jest.fn(),
    fetchDetail: jest.fn(async () => ({
      jdText: '• 백엔드 경력 3년 이상',
      rawSkillTags: ['Java', 'Spring Boot'],
    })),
  };
};

const listOnlySource = (source: string) => {
  return { source, fetchList: jest.fn() };
};

describe('FetchPostingDetailUsecase', () => {
  it('상세를 가져와 본문과 스킬을 저장한다', async () => {
    const repository = stubRepository([stored()]);
    const jumpit = detailSource('jumpit');
    const usecase = new FetchPostingDetailUsecase(
      [jumpit] as never,
      repository as never,
    );

    const result = await usecase.execute({ threshold: 60, limit: 20 });

    expect(result.attempted).toBe(1);
    expect(result.updated).toBe(1);
    expect(jumpit.fetchDetail).toHaveBeenCalledWith('100');
    expect(repository.saveDetail).toHaveBeenCalledWith({
      id: 1,
      jdText: '• 백엔드 경력 3년 이상',
      skillTags: ['Java', 'Spring Boot'],
      rawSkillTags: ['Java', 'Spring Boot'],
    });
  });

  it('상세를 못 주는 소스는 건너뛴다 — 랠릿은 상세 엔드포인트가 확인되지 않았다', async () => {
    const repository = stubRepository([stored({ source: 'rallit' })]);
    const usecase = new FetchPostingDetailUsecase(
      [listOnlySource('rallit')] as never,
      repository as never,
    );

    const result = await usecase.execute({ threshold: 60, limit: 20 });

    expect(result.skippedNoDetailSupport).toBe(1);
    expect(result.updated).toBe(0);
    expect(repository.saveDetail).not.toHaveBeenCalled();
  });

  it('한 건이 실패해도 나머지를 계속한다', async () => {
    const repository = stubRepository([
      stored(),
      stored({ id: 2, sourceId: '200' }),
    ]);
    const jumpit = detailSource('jumpit');
    jumpit.fetchDetail = jest
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({ jdText: '본문', rawSkillTags: [] });
    const usecase = new FetchPostingDetailUsecase(
      [jumpit] as never,
      repository as never,
    );

    const result = await usecase.execute({ threshold: 60, limit: 20 });

    expect(result.attempted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(1);
  });

  it('저장소에 상한을 그대로 넘긴다 — 첫 실행에 수백 회를 치지 않기 위해서다', async () => {
    const repository = stubRepository([]);
    const usecase = new FetchPostingDetailUsecase(
      [] as never,
      repository as never,
    );

    await usecase.execute({ threshold: 60, limit: 20 });

    expect(repository.findDetailTargets).toHaveBeenCalledWith(
      60,
      20,
      expect.any(Date),
    );
  });

  it('실제 호출 사이에만 지연을 둔다 — 배열 인덱스가 아니라 시도 횟수로 센다', async () => {
    // 랠릿(상세 미지원)은 HTTP 호출 없이 건너뛴다. 배열 인덱스로 지연을 걸면
    // 그 뒤 첫 실제 호출이 index > 0 에 걸려 불필요하게 기다린다 — 후보가
    // 점수 순 정렬이고 랠릿 비중이 크므로 흔한 조합이다.
    jest.useFakeTimers();
    try {
      const repository = stubRepository([
        stored({ id: 1, source: 'rallit', sourceId: '1' }),
        stored({ id: 2, source: 'jumpit', sourceId: '2' }),
        stored({ id: 3, source: 'jumpit', sourceId: '3' }),
      ]);
      const jumpit = detailSource('jumpit');
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const usecase = new FetchPostingDetailUsecase(
        [listOnlySource('rallit'), jumpit] as never,
        repository as never,
      );

      const resultPromise = usecase.execute({ threshold: 60, limit: 20 });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // 실제 호출은 두 번(jumpit×2)이라 지연은 그 사이 한 번만 걸려야 한다.
      // 랠릿 건너뛰기 뒤 첫 jumpit 호출은 기다리면 안 된다.
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(result.skippedNoDetailSupport).toBe(1);
      expect(result.updated).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
