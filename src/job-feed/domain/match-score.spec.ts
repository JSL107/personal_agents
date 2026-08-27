import { NormalizedJobPosting } from './job-feed.type';
import { buildMatchProfile, scorePosting } from './match-score';

const posting = (
  override: Partial<NormalizedJobPosting> = {},
): NormalizedJobPosting => {
  return {
    source: 'jumpit',
    sourceId: '1',
    company: '토스',
    companyKey: 'toss',
    title: '백엔드 개발자',
    detailUrl: 'https://example.test/1',
    skillTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
    rawSkillTags: [],
    minYears: 3,
    maxYears: 7,
    yearsSource: 'RANGE',
    rawJobLevel: null,
    experienceLevel: 'mid',
    locations: ['서울'],
    rawLocations: [],
    normalizedKey: 'toss|백엔드개발자',
    contentHash: 'x',
    ...override,
  };
};

describe('buildMatchProfile', () => {
  it('프로필 기술도 공고와 같은 사전으로 정규화한다', () => {
    const profile = buildMatchProfile({
      techTags: ['SpringBoot', 'nodejs'],
      years: 5,
      locations: ['서울'],
    });
    expect(profile.skillTags).toEqual(['Spring Boot', 'Node.js']);
  });
});

describe('scorePosting', () => {
  it('스킬이 전부 겹치고 연차·지역이 맞으면 만점에 가깝다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({
        techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
        years: 5,
        locations: ['서울'],
      }),
    );
    expect(result.skillHitRatio).toBe(1);
    expect(result.yearsFit).toBe('FIT');
    expect(result.locationFit).toBe(true);
    expect(result.score).toBe(100);
  });

  it('겹치는 스킬과 빠진 스킬을 함께 돌려준다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({ techTags: ['Java', 'AWS'], years: 5, locations: [] }),
    );
    expect(result.matchedSkills).toEqual(['Java', 'AWS']);
    expect(result.missingSkills).toEqual(['Spring Boot', 'MSA']);
  });

  it('연차가 구간보다 낮으면 감점한다', () => {
    const under = scorePosting(
      posting(),
      buildMatchProfile({
        techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
        years: 1,
        locations: ['서울'],
      }),
    );
    expect(under.yearsFit).toBe('UNDER');
    expect(under.score).toBeLessThan(100);
  });

  it('연차 설정이 없으면 그 축을 빼고 매긴다 — 0점 처리하지 않는다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({
        techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
        years: null,
        locations: ['서울'],
      }),
    );
    expect(result.yearsFit).toBe('NEUTRAL');
    expect(result.score).toBe(100);
  });

  it('경력 무관 공고는 연차 축이 중립이다', () => {
    const result = scorePosting(
      posting({ minYears: null, maxYears: null, experienceLevel: 'any' }),
      buildMatchProfile({
        techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
        years: 3,
        locations: ['서울'],
      }),
    );
    expect(result.yearsFit).toBe('NEUTRAL');
  });

  it('상한이 없는 공고는 연차가 높아도 맞는 것으로 본다', () => {
    const result = scorePosting(
      posting({ minYears: 7, maxYears: null }),
      buildMatchProfile({ techTags: ['Java'], years: 20, locations: [] }),
    );
    expect(result.yearsFit).toBe('FIT');
  });

  it('겹치는 스킬이 없으면 낮은 점수가 나온다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({
        techTags: ['Python', 'Django'],
        years: 5,
        locations: ['서울'],
      }),
    );
    expect(result.skillHitRatio).toBe(0);
    expect(result.score).toBeLessThan(50);
  });

  it('공고에 스킬 태그가 없으면 스킬 축을 중립으로 둔다', () => {
    const result = scorePosting(
      posting({ skillTags: [] }),
      buildMatchProfile({ techTags: ['Java'], years: 5, locations: ['서울'] }),
    );
    expect(result.skillHitRatio).toBe(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it('점수는 0~100 정수다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({ techTags: ['Java'], years: 1, locations: ['부산'] }),
    );
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
