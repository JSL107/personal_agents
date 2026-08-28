import { ListNotifiablePostingsUsecase } from './list-notifiable-postings.usecase';

const storedPosting = (override: Record<string, unknown> = {}) => {
  return {
    id: 1,
    source: 'jumpit',
    sourceId: '1',
    company: '토스',
    title: '백엔드 개발자',
    detailUrl: 'https://example.test/1',
    skillTags: ['Java', 'Spring Boot'],
    rawSkillTags: [],
    minYears: 3,
    maxYears: 7,
    experienceLevel: 'mid',
    locations: ['서울'],
    normalizedKey: 'toss|백엔드개발자',
    jdText: null,
    matchScore: 90,
    ...override,
  };
};

const stubRepository = (
  candidates: unknown[],
  claimResult: boolean | ((key: string) => boolean) = true,
) => {
  return {
    upsertMany: jest.fn(),
    findScoringTargets: jest.fn(),
    saveScore: jest.fn(),
    findNotifiable: jest.fn(async () => candidates),
    claimForNotification: jest.fn(async (normalizedKey: string) => {
      return typeof claimResult === 'function'
        ? claimResult(normalizedKey)
        : claimResult;
    }),
    findDetailTargets: jest.fn(),
    saveDetail: jest.fn(),
    findGapCandidates: jest.fn(),
    saveGapAgentRunId: jest.fn(),
  };
};

describe('ListNotifiablePostingsUsecase', () => {
  it('같은 normalizedKey 후보가 여럿이면 claimForNotification 을 한 번만 부른다', async () => {
    const candidates = [
      storedPosting({ id: 1, source: 'jumpit' }),
      storedPosting({ id: 2, source: 'rallit' }),
    ];
    const repository = stubRepository(candidates, true);
    const usecase = new ListNotifiablePostingsUsecase(repository as never);

    const result = await usecase.execute({ threshold: 80, limit: 20 });

    // 같은 normalizedKey 는 첫 후보만 시도한다 — 선점 1회, 결과도 1건.
    expect(repository.claimForNotification).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it('peek: true 면 선점 없이 원본 후보를 그대로 돌려준다', async () => {
    const candidates = [
      storedPosting({ id: 1 }),
      storedPosting({ id: 2, normalizedKey: 'wanted|백엔드개발자' }),
    ];
    const repository = stubRepository(candidates, true);
    const usecase = new ListNotifiablePostingsUsecase(repository as never);

    const result = await usecase.execute({
      threshold: 80,
      limit: 20,
      peek: true,
    });

    expect(repository.claimForNotification).not.toHaveBeenCalled();
    expect(result).toBe(candidates);
  });

  it('claimForNotification 이 false 를 주면 그 후보는 결과에서 빠진다', async () => {
    const candidates = [storedPosting({ id: 1 })];
    const repository = stubRepository(candidates, false);
    const usecase = new ListNotifiablePostingsUsecase(repository as never);

    const result = await usecase.execute({ threshold: 80, limit: 20 });

    expect(result).toEqual([]);
  });
});
