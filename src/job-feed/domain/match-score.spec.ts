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

  it('포화점을 넘겨 맞혀도 더 오르지 않는다 — 증거 축의 상한', () => {
    // 증가만 확인하면 상한이 없어도(맞힌 개수를 그대로 더해도) 통과한다.
    // 4개와 5개 이상이 같은 값이어야 포화가 실제로 작동하는 것이다.
    const profile = buildMatchProfile({
      techTags: ['Java', 'Spring Boot', 'AWS', 'MSA', 'Kafka', 'Redis'],
      years: 5,
      locations: ['서울'],
    });
    const scoreOf = (skillTags: string[]): number => {
      return scorePosting(posting({ skillTags }), profile).score;
    };
    const four = scoreOf(['Java', 'Spring Boot', 'AWS', 'MSA']);
    expect(scoreOf(['Java', 'Spring Boot', 'AWS', 'MSA', 'Kafka'])).toBe(four);
    expect(
      scoreOf(['Java', 'Spring Boot', 'AWS', 'MSA', 'Kafka', 'Redis']),
    ).toBe(four);
    expect(four).toBe(100);
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

  // 🔴 2026-08-31 실측 결함의 회귀 테스트. 사전이 화이트리스트로 동작하던 때는 공고가
  // 요구한 기술 중 사전이 아는 것만 남아 분모가 줄었고, 프론트 스택만 적힌 공고가
  // 만점을 받았다(실측 247건 중 97건이 기준점 80 통과 — 필터가 사실상 무효).
  it('사전에 없는 요구 기술도 분모에 센다 — 아는 것만 남겨 만점을 주지 않는다', () => {
    const frontendHeavy = posting({
      skillTags: ['React', 'CSS', 'HTML', 'JavaScript'],
    });
    const result = scorePosting(
      frontendHeavy,
      buildMatchProfile({
        techTags: ['JavaScript'],
        years: 5,
        locations: ['서울'],
      }),
    );
    expect(result.matchedSkills).toEqual(['JavaScript']);
    expect(result.missingSkills).toEqual(['React', 'CSS', 'HTML']);
    expect(result.skillHitRatio).toBeCloseTo(0.25);
    expect(result.score).toBeLessThan(80);
  });

  it('사전에 없어도 공고와 프로필 양쪽에 있으면 만난다 — 예전에는 둘 다 버려져 못 만났다', () => {
    const result = scorePosting(
      posting({ skillTags: ['Firebase', 'OpenCV'] }),
      buildMatchProfile({
        techTags: ['OpenCV'],
        years: 5,
        locations: ['서울'],
      }),
    );
    expect(result.matchedSkills).toEqual(['OpenCV']);
  });

  it('표기만 다른 같은 기술은 키로 비교해 만난다', () => {
    const result = scorePosting(
      posting({ skillTags: ['OpenCV'] }),
      buildMatchProfile({
        techTags: ['open-cv'],
        years: 5,
        locations: ['서울'],
      }),
    );
    expect(result.matchedSkills).toEqual(['OpenCV']);
  });

  // 이 피드는 백엔드 공고를 고르는 것이 목적이다. 곁다리로 익힌 프론트 기술이
  // 매칭에 쓰이면 프론트 공고가 만점으로 올라온다 — 실측(2026-08-31)에서
  // 'Backend Engineer' 제목에 React·TypeScript·Next.js 만 적힌 공고가 3/3 = 100점.
  it('프로필의 프론트·모바일 전용 기술은 매칭에 쓰지 않는다', () => {
    const profile = buildMatchProfile({
      techTags: ['TypeScript', 'React', 'Next.js', 'Swift', 'NestJS'],
      years: 5,
      locations: ['서울'],
    });
    expect(profile.skillTags).toEqual(['TypeScript', 'NestJS']);

    const result = scorePosting(
      posting({ skillTags: ['React', 'TypeScript', 'Next.js'] }),
      profile,
    );
    expect(result.matchedSkills).toEqual(['TypeScript']);
    expect(result.missingSkills).toEqual(['React', 'Next.js']);
    expect(result.score).toBeLessThan(80);
  });

  // 🔴 공고 쪽에서 빼면 프론트 스택만 적힌 공고가 "요구사항 없는 공고" 가 돼 다시
  // 만점으로 올라온다 — 이 파일이 고친 결함의 재발 경로다.
  it('공고 쪽 프론트 기술은 분모에 그대로 남는다 — 못 맞추는 요구도 요구다', () => {
    const result = scorePosting(
      posting({ skillTags: ['React', 'CSS', 'Java'] }),
      buildMatchProfile({ techTags: ['Java'], years: 5, locations: ['서울'] }),
    );
    expect(result.skillHitRatio).toBeCloseTo(1 / 3);
  });

  // 양쪽에서 쓰는 언어까지 빼면 백엔드 매칭 자체가 무너진다.
  it('양쪽에서 쓰는 언어는 빼지 않는다 — TypeScript 는 이 프로필의 백엔드 주력이다', () => {
    const profile = buildMatchProfile({
      techTags: ['TypeScript', 'JavaScript', 'Kotlin', 'Node.js'],
      years: 5,
      locations: ['서울'],
    });
    expect(profile.skillTags).toEqual([
      'TypeScript',
      'JavaScript',
      'Kotlin',
      'Node.js',
    ]);
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
