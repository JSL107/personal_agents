import { toContentHash } from '../domain/dedupe';
import { ReprocessJobPostingsUsecase } from './reprocess-job-postings.usecase';

const stored = (override: Record<string, unknown> = {}) => {
  return {
    id: 1,
    source: 'jumpit',
    sourceId: '1',
    company: '토스',
    companyKey: 'toss',
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
    // 지문을 새 태그 기준으로 함께 찍어야 한다. 옛 지문을 두면 다음 수집이 이 행을
    // "요건 변경" 으로 오인해 notifiedAt 을 지우고, 재파생만 했을 뿐인데 이미 본
    // 공고가 통째로 다시 알림된다(job-posting.prisma.repository 의 changed 분기).
    expect(repository.saveSkillTags).toHaveBeenCalledWith(
      1,
      ['Java', 'Spring Boot'],
      toContentHash({
        companyKey: 'toss',
        title: '백엔드 개발자',
        skillTags: ['Java', 'Spring Boot'],
        minYears: 3,
        maxYears: 7,
        experienceLevel: 'mid',
        locations: ['서울'],
      }),
    );
    // 옛 태그로 찍은 지문과 실제로 달라야 의미가 있다.
    expect(
      toContentHash({
        companyKey: 'toss',
        title: '백엔드 개발자',
        skillTags: ['Java'],
        minYears: 3,
        maxYears: 7,
        experienceLevel: 'mid',
        locations: ['서울'],
      }),
    ).not.toBe(
      toContentHash({
        companyKey: 'toss',
        title: '백엔드 개발자',
        skillTags: ['Java', 'Spring Boot'],
        minYears: 3,
        maxYears: 7,
        experienceLevel: 'mid',
        locations: ['서울'],
      }),
    );
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
