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

  it('공고에 스킬 태그가 없으면 비율 축만 중립으로 두고 증거 축은 0으로 둔다', () => {
    // 태그가 없으면 판단 근거가 없다 — 비율은 중립(0.5)이되 "맞힌 게 하나도 없다"는
    // 사실은 그대로 반영한다. 이 행이 상세 수집에서 빠지는 데드락은 점수가 아니라
    // findDetailTargets 의 skillTags isEmpty 예외가 막는다.
    const result = scorePosting(
      posting({ skillTags: [] }),
      buildMatchProfile({ techTags: ['Java'], years: 5, locations: ['서울'] }),
    );
    expect(result.skillHitRatio).toBe(0);
    expect(result.score).toBe(55);
  });

  it('요구 기술을 다 맞혀도 한 개뿐이면 여러 개를 맞춘 공고보다 낮다', () => {
    // 비율만 보던 시절엔 둘 다 100 점이라 알림 상위 10 건이 만점 동점으로만
    // 채워졌다. 카드에서 무엇이 더 나은 공고인지 구분되지 않던 원인이다.
    const shallow = scorePosting(
      posting({ skillTags: ['Java'] }),
      buildMatchProfile({
        techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
        years: 5,
        locations: ['서울'],
      }),
    );
    const deep = scorePosting(
      posting({ skillTags: ['Java', 'Spring Boot', 'AWS', 'MSA'] }),
      buildMatchProfile({
        techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
        years: 5,
        locations: ['서울'],
      }),
    );
    expect(shallow.skillHitRatio).toBe(1);
    expect(deep.skillHitRatio).toBe(1);
    expect(shallow.score).toBeLessThan(deep.score);
    expect(deep.score).toBe(100);
  });

  it('맞힌 개수가 늘수록 점수가 오른다 — 포화점까지', () => {
    const profile = buildMatchProfile({
      techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
      years: 5,
      locations: ['서울'],
    });
    const scoreOf = (skillTags: string[]): number => {
      return scorePosting(posting({ skillTags }), profile).score;
    };
    expect(scoreOf(['Java'])).toBeLessThan(scoreOf(['Java', 'Spring Boot']));
    expect(scoreOf(['Java', 'Spring Boot'])).toBeLessThan(
      scoreOf(['Java', 'Spring Boot', 'AWS']),
    );
    expect(scoreOf(['Java', 'Spring Boot', 'AWS'])).toBeLessThan(
      scoreOf(['Java', 'Spring Boot', 'AWS', 'MSA']),
    );
  });

  it('연차가 상한을 넘으면 감점하되 미달보다는 덜 깎는다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({
        techTags: ['Java', 'Spring Boot', 'AWS', 'MSA'],
        years: 9,
        locations: ['서울'],
      }),
    );
    expect(result.yearsFit).toBe('OVER');
    expect(result.score).toBe(90);
  });

  it('연차가 정확히 하한이면 맞는 것으로 본다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({ techTags: ['Java'], years: 3, locations: [] }),
    );
    expect(result.yearsFit).toBe('FIT');
  });

  it('연차가 정확히 상한이면 맞는 것으로 본다', () => {
    const result = scorePosting(
      posting(),
      buildMatchProfile({ techTags: ['Java'], years: 7, locations: [] }),
    );
    expect(result.yearsFit).toBe('FIT');
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
