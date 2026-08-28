import { formatJobFeedDigest } from './job-feed.formatter';

const posting = (override: Record<string, unknown> = {}) => {
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
    matchScore: 82,
    ...override,
  };
};

describe('formatJobFeedDigest', () => {
  it('회사·연차·스킬·점수를 한 줄에 담는다', () => {
    const text = formatJobFeedDigest({
      postings: [posting()],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('토스');
    expect(text).toContain('백엔드 개발자');
    expect(text).toContain('3~7년');
    expect(text).toContain('Java');
    expect(text).toContain('82');
  });

  it('상한이 없으면 이상으로 적는다', () => {
    const text = formatJobFeedDigest({
      postings: [posting({ minYears: 7, maxYears: null })],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('7년 이상');
  });

  it('연차 정보가 없으면 경력 무관으로 적는다', () => {
    const text = formatJobFeedDigest({
      postings: [posting({ minYears: null, maxYears: null })],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('경력 무관');
  });

  it('슬랙 제어문자를 escape 한다 — 회사명은 외부 문자열이다', () => {
    const text = formatJobFeedDigest({
      postings: [posting({ company: 'A&B <주식회사>', title: '*백엔드*' })],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('&amp;');
    expect(text).toContain('&lt;');
    expect(text).not.toContain('<주식회사>');
  });

  it('소스별 상태를 각주로 붙인다 — 한 소스가 조용히 빠진 것을 알아차릴 유일한 경로다', () => {
    const text = formatJobFeedDigest({
      postings: [posting()],
      outcomes: [
        {
          source: 'jumpit',
          status: 'SUCCESS',
          received: 126,
          validated: 126,
          accepted: 42,
          httpStatus: null,
          error: null,
        },
        {
          source: 'rallit',
          status: 'FAILED',
          received: 0,
          validated: 0,
          accepted: 0,
          httpStatus: null,
          error: 'HTTP 403',
        },
      ],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('점핏');
    expect(text).toContain('랠릿');
    expect(text).toContain('실패');
  });

  it('공고가 없으면 그 사실과 소스 상태를 함께 알린다', () => {
    const text = formatJobFeedDigest({
      postings: [],
      outcomes: [
        {
          source: 'jumpit',
          status: 'SUCCESS',
          received: 126,
          validated: 126,
          accepted: 0,
          httpStatus: null,
          error: null,
        },
      ],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('조건에 맞는');
    expect(text).toContain('점핏');
  });

  it('사전 미매칭 태그를 각주에 노출한다', () => {
    const text = formatJobFeedDigest({
      postings: [posting()],
      outcomes: [],
      unmatchedSkillTags: [
        { tag: 'Quarkus', count: 5 },
        { tag: 'Temporal', count: 3 },
      ],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('Quarkus');
  });

  describe('lastCollectedAt — 신선도 조건 도입 후 새로 생긴 실패 모드를 드러낸다', () => {
    // findAllForReprocess 를 제외한 조회들이 lastSeenAt 신선도 조건(이틀)을 걸기
    // 시작하면서, 수집이 이틀 넘게 실패하면 postings 조회가 전부 조용히 비어
    // "오늘은 조건에 맞는 공고 없음"으로 보이는 새 실패 모드가 생겼다. 실제
    // 원인은 수집기 장애인데 카드만 보면 구분할 수 없다 — 마지막 수집 시각을
    // 각주에 반드시 남겨야 한다.

    it('null 이면 수집 기록 없음을 알린다', () => {
      const text = formatJobFeedDigest({
        postings: [posting()],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: null,
      });
      expect(text).toContain('수집 기록 없음');
    });

    it('최근 수집이면 경고 없이 시각만 보여준다', () => {
      const recent = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전
      const text = formatJobFeedDigest({
        postings: [posting()],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: recent,
      });
      expect(text).toContain('마지막 수집');
      expect(text).not.toContain('⚠️');
    });

    it('24시간을 넘겼으면 눈에 띄게 경고한다', () => {
      const stale = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30시간 전
      const text = formatJobFeedDigest({
        postings: [posting()],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: stale,
      });
      expect(text).toContain('⚠️');
      expect(text).toContain('마지막 수집');
    });
  });
});
