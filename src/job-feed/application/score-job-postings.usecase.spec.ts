import { ScoreJobPostingsUsecase } from './score-job-postings.usecase';

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
    matchScore: null,
    ...override,
  };
};

const stubRepository = (targets: unknown[]) => {
  return {
    findScoringTargets: jest.fn(async () => targets),
    saveScore: jest.fn(async () => undefined),
    upsertMany: jest.fn(),
    findNotifiable: jest.fn(),
    claimForNotification: jest.fn(),
    findDetailTargets: jest.fn(),
    saveDetail: jest.fn(),
    findGapCandidates: jest.fn(),
    saveGapAgentRunId: jest.fn(),
  };
};

describe('ScoreJobPostingsUsecase', () => {
  it('프로필 기술이 겹치면 점수를 저장한다', async () => {
    const repository = stubRepository([storedPosting()]);
    const usecase = new ScoreJobPostingsUsecase(repository as never);

    const result = await usecase.execute({
      techTags: ['Java', 'Spring Boot'],
      years: 5,
      locations: ['서울'],
      profileId: 19,
    });

    expect(result.scored).toBe(1);
    expect(repository.saveScore).toHaveBeenCalledWith({
      id: 1,
      matchScore: 100,
      scoredProfileId: 19,
    });
  });

  it('프로필 기술이 하나도 없으면 채점하지 않고 이유를 남긴다', async () => {
    const repository = stubRepository([storedPosting()]);
    const usecase = new ScoreJobPostingsUsecase(repository as never);

    const result = await usecase.execute({
      techTags: [],
      years: 5,
      locations: ['서울'],
      profileId: null,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('프로필');
    expect(repository.saveScore).not.toHaveBeenCalled();
  });

  it('점수 분포를 함께 돌려준다 — 항상 0점인 상태를 첫 실행에 드러내기 위해서다', async () => {
    const repository = stubRepository([
      storedPosting(),
      storedPosting({ id: 2, skillTags: ['Python', 'Django'] }),
    ]);
    const usecase = new ScoreJobPostingsUsecase(repository as never);

    const result = await usecase.execute({
      techTags: ['Java', 'Spring Boot'],
      years: 5,
      locations: ['서울'],
      profileId: 19,
    });

    expect(result.scored).toBe(2);
    expect(Object.values(result.histogram).reduce((a, b) => a + b, 0)).toBe(2);
    expect(result.profileTokenCount).toBe(2);
  });
});
