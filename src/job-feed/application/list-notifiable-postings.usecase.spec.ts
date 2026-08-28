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

const stubRepository = (candidates: unknown[]) => {
  return {
    upsertMany: jest.fn(),
    findScoringTargets: jest.fn(),
    saveScore: jest.fn(),
    findNotifiable: jest.fn(async () => candidates),
    claimForNotification: jest.fn(),
    findDetailTargets: jest.fn(),
    saveDetail: jest.fn(),
    findGapCandidates: jest.fn(),
    saveGapAgentRunId: jest.fn(),
  };
};

describe('ListNotifiablePostingsUsecase', () => {
  it('선점하지 않고 후보를 그대로 돌려준다 — claimForNotification 은 발송 성공 후 별도로 호출된다', async () => {
    const candidates = [storedPosting({ id: 1 })];
    const repository = stubRepository(candidates);
    const usecase = new ListNotifiablePostingsUsecase(repository as never);

    const result = await usecase.execute({ threshold: 80, limit: 20 });

    expect(repository.claimForNotification).not.toHaveBeenCalled();
    expect(result).toEqual(candidates);
  });

  it('같은 normalizedKey 후보가 여럿이면 첫 후보만 남기고 나머지는 뺀다', async () => {
    const candidates = [
      storedPosting({ id: 1, source: 'jumpit' }),
      storedPosting({ id: 2, source: 'rallit' }),
    ];
    const repository = stubRepository(candidates);
    const usecase = new ListNotifiablePostingsUsecase(repository as never);

    const result = await usecase.execute({ threshold: 80, limit: 20 });

    // 같은 공고가 여러 소스로 들어와도 카드에는 한 번만 올린다.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, source: 'jumpit' });
  });

  it('avoidSkillTags 를 repository.findNotifiable 에 그대로 전달한다', async () => {
    const repository = stubRepository([]);
    const usecase = new ListNotifiablePostingsUsecase(repository as never);

    await usecase.execute({
      threshold: 80,
      limit: 20,
      avoidSkillTags: ['PHP', 'JSP'],
    });

    expect(repository.findNotifiable).toHaveBeenCalledWith(80, 20, [
      'PHP',
      'JSP',
    ]);
  });

  it('avoidSkillTags 를 안 주면 빈 배열을 전달한다', async () => {
    const repository = stubRepository([]);
    const usecase = new ListNotifiablePostingsUsecase(repository as never);

    await usecase.execute({ threshold: 80, limit: 20 });

    expect(repository.findNotifiable).toHaveBeenCalledWith(80, 20, []);
  });
});
