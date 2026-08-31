import { formatJobFeedDigest, JobFeedDigestInput } from './job-feed.formatter';

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

// 이 파일의 단언 대부분은 "무엇이 카드에 실리는가"를 본다 — 메인이든 스레드든 실리기만
// 하면 되는 검증이라 두 조각을 합쳐서 본다. 어느 쪽에 실리는지는 아래
// '메인과 스레드로 나눈다' 가 따로 단언한다.
const renderAll = (
  input: Omit<JobFeedDigestInput, 'firedAtKst'> & { firedAtKst?: string },
): string => {
  const { summary, detail } = formatJobFeedDigest({
    firedAtKst: '2026-08-31',
    ...input,
  });
  return detail === null ? summary : `${summary}\n${detail}`;
};

describe('formatJobFeedDigest', () => {
  it('회사·직무·연차·지역·스킬을 담는다', () => {
    const text = renderAll({
      postings: [posting()],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('토스');
    expect(text).toContain('백엔드 개발자');
    expect(text).toContain('3~7년');
    expect(text).toContain('Java');
  });

  it('점수는 카드에 적지 않는다 — 상위 열 건이 늘 같은 값이라 자리만 차지했다', () => {
    const text = renderAll({
      postings: [posting()],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).not.toContain('82점');
    expect(text).not.toContain('[82');
  });

  it('기술은 네 개까지만 적는다 — 그 이상은 줄이 회사명보다 무거워진다', () => {
    const text = renderAll({
      postings: [
        posting({
          skillTags: ['Java', 'Spring Boot', 'AWS', 'MSA', 'Kafka', 'Redis'],
        }),
      ],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('MSA');
    expect(text).not.toContain('Kafka');
    expect(text).not.toContain('Redis');
  });

  describe('카드 구조 — 회사명을 세로로 훑을 수 있어야 한다', () => {
    // 부분 문자열만 보면 배지가 앞에 붙든 회사명이 링크에 묶이든 통과한다.
    // 줄 단위로 구조를 단언해야 그 회귀를 잡는다.
    const linesOf = (): string[] => {
      return renderAll({
        postings: [posting()],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: new Date(),
      }).split('\n');
    };

    it('회사명이 줄 맨 앞에 굵게 오고 링크는 직무명에만 걸린다', () => {
      const companyLine = linesOf().find((line) => {
        return line.includes('토스');
      });
      expect(companyLine).toBe(
        '*토스* — <https://example.test/1|백엔드 개발자>',
      );
    });

    it('연차·지역·스킬은 인용 줄로 내려간다', () => {
      // 기울임(`_..._`)을 쓰면 안 된다 — 슬랙 이탤릭은 색을 바꾸지 않아 눌러쓰기가
      // 되지 않고, 한글은 기울임체가 없어 강제로 비스듬히 그려져 읽기 나빠진다.
      const metaLine = linesOf().find((line) => {
        return line.includes('3~7년');
      });
      expect(metaLine).toBe('> 3~7년 · 서울 · Java · Spring Boot');
      expect(metaLine?.startsWith('_')).toBe(false);
    });

    it('점수 배지가 줄 앞머리를 차지하지 않는다', () => {
      for (const line of linesOf()) {
        expect(line.startsWith('• [')).toBe(false);
        expect(line.startsWith('[82점]')).toBe(false);
      }
    });

    it('한 건은 회사 줄과 인용 줄 두 줄로 끝난다 — 사이에 빈 줄을 넣지 않는다', () => {
      // 인용선이 이미 덩어리를 갈라 준다. 빈 줄까지 넣으면 열 건에서 세로가 절반 더
      // 길어져 스크롤만 늘고 얻는 게 없다.
      const text = renderAll({
        postings: [posting(), posting({ id: 2, company: '카카오' })],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: new Date(),
      });
      const lines = text.split('\n');
      const secondCompanyIndex = lines.findIndex((line) => {
        return line.includes('카카오');
      });
      expect(lines[secondCompanyIndex - 1]).toBe(
        '> 3~7년 · 서울 · Java · Spring Boot',
      );
    });
  });

  it('상한이 없으면 이상으로 적는다', () => {
    const text = renderAll({
      postings: [posting({ minYears: 7, maxYears: null })],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('7년 이상');
  });

  it('연차 정보가 없으면 경력 무관으로 적는다', () => {
    const text = renderAll({
      postings: [posting({ minYears: null, maxYears: null })],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('경력 무관');
  });

  it('슬랙 제어문자를 escape 한다 — 회사명은 외부 문자열이다', () => {
    const text = renderAll({
      postings: [posting({ company: 'A&B <주식회사>', title: '*백엔드*' })],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('&amp;');
    expect(text).toContain('&lt;');
    expect(text).not.toContain('<주식회사>');
  });

  it('지역 문자열도 escape 한다 — 점핏·원티드는 원본 표기를 그대로 쓴다', () => {
    const text = renderAll({
      postings: [posting({ locations: ['<서울> & 경기'] })],
      outcomes: [],
      unmatchedSkillTags: [],
      lastCollectedAt: new Date(),
    });
    expect(text).toContain('&lt;');
    expect(text).toContain('&amp;');
    expect(text).not.toContain('<서울>');
  });

  it('소스별 상태를 각주로 붙인다 — 한 소스가 조용히 빠진 것을 알아차릴 유일한 경로다', () => {
    const text = renderAll({
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
    const text = renderAll({
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
    const text = renderAll({
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

  describe('scoreSkipReason — 채점 자체를 안 한 것과 "조건 미달 0건"을 구분한다', () => {
    it('채점을 건너뛰었으면 그 사유를 각주에 남긴다', () => {
      const text = renderAll({
        postings: [],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: new Date(),
        scoreSkipReason:
          '커리어 프로필에 사전과 맞는 기술 태그가 없어 채점을 건너뜁니다.',
      });
      expect(text).toContain('채점 건너뜀');
      expect(text).toContain(
        '커리어 프로필에 사전과 맞는 기술 태그가 없어 채점을 건너뜁니다.',
      );
    });

    it('채점이 정상 수행됐으면(사유 없음) 그 각주를 넣지 않는다', () => {
      const text = renderAll({
        postings: [],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: new Date(),
      });
      expect(text).not.toContain('채점 건너뜀');
    });
  });

  describe('lastCollectedAt — 신선도 조건 도입 후 새로 생긴 실패 모드를 드러낸다', () => {
    // findAllForReprocess 를 제외한 조회들이 lastSeenAt 신선도 조건(이틀)을 걸기
    // 시작하면서, 수집이 이틀 넘게 실패하면 postings 조회가 전부 조용히 비어
    // "오늘은 조건에 맞는 공고 없음"으로 보이는 새 실패 모드가 생겼다. 실제
    // 원인은 수집기 장애인데 카드만 보면 구분할 수 없다 — 마지막 수집 시각을
    // 각주에 반드시 남겨야 한다.

    it('null 이면 수집 기록 없음을 알린다', () => {
      const text = renderAll({
        postings: [posting()],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: null,
      });
      expect(text).toContain('수집 기록 없음');
    });

    it('최근 수집이면 경고 없이 시각만 보여준다', () => {
      const recent = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전
      const text = renderAll({
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
      const text = renderAll({
        postings: [posting()],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: stale,
      });
      expect(text).toContain('⚠️');
      expect(text).toContain('마지막 수집');
    });
  });
  describe('메인과 스레드로 나눈다 — 열 건이 메인에 실리면 채널을 통째로 밀어낸다', () => {
    const render = (postings: ReturnType<typeof posting>[]) => {
      return formatJobFeedDigest({
        postings,
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: new Date(),
        firedAtKst: '2026-08-31',
      });
    };

    it('공고 목록은 스레드(detail)로 가고 메인에는 남지 않는다', () => {
      const { summary, detail } = render([posting()]);
      expect(detail).toContain('토스');
      expect(summary).not.toContain('토스');
    });

    it('메인은 건수와 날짜만 제목으로 낸다', () => {
      const { summary } = render([posting(), posting({ id: 2 })]);
      expect(summary.split('\n')[0]).toBe(
        '*새 백엔드 공고 2건* — 8월 31일 (월)',
      );
    });

    it('진단 각주는 메인에 남긴다 — 스레드로 내리면 접힌 채 아무도 못 본다', () => {
      const { summary, detail } = formatJobFeedDigest({
        postings: [posting()],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: null,
        firedAtKst: '2026-08-31',
      });
      expect(summary).toContain('수집 기록 없음');
      expect(detail).not.toContain('수집 기록 없음');
    });

    it('공고가 없으면 detail 이 null 이다 — 빈 스레드 댓글을 달지 않는다', () => {
      const { summary, detail } = render([]);
      expect(detail).toBeNull();
      expect(summary).toContain('조건에 맞는 공고가 없습니다.');
      expect(summary).toContain('8월 31일');
    });

    it('날짜를 파싱할 수 없으면 원문을 그대로 둔다 — 통째로 빼지 않는다', () => {
      const { summary } = formatJobFeedDigest({
        postings: [],
        outcomes: [],
        unmatchedSkillTags: [],
        lastCollectedAt: new Date(),
        firedAtKst: 'not-a-date',
      });
      expect(summary).toContain('not-a-date');
    });
  });
});
