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
    // 🔴 지문(contentHash)은 넘기지 않는다. 이 저장소에서 지문의 주인은 수집이고,
    // 상세를 받은 행은 지문만 목록 기준으로 유지한다 — 여기서 상세 태그로 다시 찍으면
    // 다음 목록 수집과 어긋나 upsertMany 가 "요건 변경" 으로 오인하고 이미 발송한
    // 공고를 다시 알린다(usecase 주석 참조).
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
