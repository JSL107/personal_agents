import { ReprocessJobPostingsUsecase } from './reprocess-job-postings.usecase';

const stored = (override: Record<string, unknown> = {}) => {
  return {
    id: 1,
    source: 'jumpit',
    sourceId: '1',
    company: '토스',
    title: '백엔드 개발자',
    detailUrl: 'https://example.test/1',
    skillTags: ['Java'],
    rawSkillTags: ['Java', 'SpringBoot'],
    minYears: 3,
    maxYears: 7,
    experienceLevel: 'mid',
    locations: ['서울'],
    normalizedKey: 'toss|백엔드개발자',
    jdText: null,
    matchScore: 50,
    ...override,
  };
};

const stubRepository = (rows: unknown[]) => {
  return {
    findAllForReprocess: jest.fn(async () => rows),
    saveSkillTags: jest.fn(async () => undefined),
    upsertMany: jest.fn(),
    findScoringTargets: jest.fn(),
    saveScore: jest.fn(),
    findNotifiable: jest.fn(),
    claimForNotification: jest.fn(),
    findDetailTargets: jest.fn(),
    saveDetail: jest.fn(),
    findGapCandidates: jest.fn(),
    saveGapAgentRunId: jest.fn(),
  };
};

describe('ReprocessJobPostingsUsecase', () => {
  it('사전에 새로 추가된 별칭을 과거 행에 소급 적용한다', async () => {
    // SpringBoot 가 사전에 있으므로 Java 하나였던 skillTags 가 둘로 늘어야 한다.
    const repository = stubRepository([stored()]);
    const usecase = new ReprocessJobPostingsUsecase(repository as never);

    const result = await usecase.execute();

    expect(result.examined).toBe(1);
    expect(result.changed).toBe(1);
    expect(repository.saveSkillTags).toHaveBeenCalledWith(1, [
      'Java',
      'Spring Boot',
    ]);
  });

  it('결과가 같으면 쓰지 않는다', async () => {
    const repository = stubRepository([
      stored({ skillTags: ['Java'], rawSkillTags: ['Java'] }),
    ]);
    const usecase = new ReprocessJobPostingsUsecase(repository as never);

    const result = await usecase.execute();

    expect(result.changed).toBe(0);
    expect(repository.saveSkillTags).not.toHaveBeenCalled();
  });
});
