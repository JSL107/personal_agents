import { toCompanyKey, toContentHash, toNormalizedKey } from './dedupe';
import { NormalizedJobPosting } from './job-feed.type';

describe('toCompanyKey', () => {
  it('법인 표기를 걷어내 같은 회사를 한 키로 모은다', () => {
    expect(toCompanyKey('(주)토스')).toBe(toCompanyKey('토스'));
    expect(toCompanyKey('주식회사 토스')).toBe(toCompanyKey('토스'));
    expect(toCompanyKey('Toss Inc.')).toBe(toCompanyKey('toss'));
  });

  it('공백과 기호를 무시한다', () => {
    expect(toCompanyKey('씨어스 테크놀로지')).toBe(
      toCompanyKey('씨어스테크놀로지'),
    );
  });
});

describe('toNormalizedKey', () => {
  it('회사와 제목이 같으면 소스가 달라도 같은 키다', () => {
    expect(toNormalizedKey('(주)토스', '백엔드 개발자')).toBe(
      toNormalizedKey('토스', '백엔드 개발자'),
    );
  });

  it('회사가 다르면 제목이 같아도 다른 키다', () => {
    expect(toNormalizedKey('토스', '백엔드 개발자')).not.toBe(
      toNormalizedKey('당근', '백엔드 개발자'),
    );
  });
});

describe('toContentHash', () => {
  const base: NormalizedJobPosting = {
    source: 'jumpit',
    sourceId: '1',
    company: '토스',
    companyKey: 'toss',
    title: '백엔드 개발자',
    detailUrl: 'https://example.test/1',
    skillTags: ['Java', 'Spring Boot'],
    rawSkillTags: ['Java', 'Spring Boot'],
    minYears: 3,
    maxYears: 7,
    yearsSource: 'RANGE',
    rawJobLevel: null,
    experienceLevel: 'mid',
    locations: ['서울'],
    rawLocations: ['서울 강남구'],
    normalizedKey: 'toss|백엔드개발자',
    contentHash: '',
  };

  it('요건이 같으면 같은 해시다', () => {
    expect(toContentHash(base)).toBe(toContentHash({ ...base }));
  });

  it('요구 스킬이 늘면 해시가 바뀐다 — 이걸로 요건 변경을 잡는다', () => {
    expect(toContentHash(base)).not.toBe(
      toContentHash({ ...base, skillTags: ['Java', 'Spring Boot', 'Kotlin'] }),
    );
  });

  it('연차가 바뀌면 해시가 바뀐다', () => {
    expect(toContentHash(base)).not.toBe(
      toContentHash({ ...base, minYears: 5 }),
    );
  });

  it('마지막 확인 시각처럼 요건과 무관한 값에는 반응하지 않는다', () => {
    expect(toContentHash(base)).toBe(
      toContentHash({ ...base, detailUrl: 'https://example.test/changed' }),
    );
  });
});
