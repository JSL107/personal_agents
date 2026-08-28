import { mapJumpitDetail, mapJumpitList } from './jumpit.mapper';

// 2026-08-27 실제 응답에서 잘라낸 표본이다. 형태가 바뀌면 이 테스트가 먼저 깨진다.
const listPayload = {
  result: {
    totalCount: 126,
    positions: [
      {
        id: 54852445,
        companyName: '씨어스테크놀로지',
        title: '백엔드 개발자 경력 채용',
        techStacks: ['Java', 'Spring Boot', 'REST API', 'AWS', 'MSA'],
        minCareer: 5,
        maxCareer: 20,
        newcomer: false,
        locations: ['경기 성남시 분당구'],
        jobCategory: '서버/백엔드 개발자',
      },
    ],
  },
};

describe('mapJumpitList', () => {
  it('실측 응답에서 공고를 뽑아낸다', () => {
    const result = mapJumpitList(listPayload);
    expect(result.received).toBe(1);
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]).toEqual({
      source: 'jumpit',
      sourceId: '54852445',
      company: '씨어스테크놀로지',
      title: '백엔드 개발자 경력 채용',
      detailUrl: 'https://jumpit.saramin.co.kr/position/54852445',
      rawSkillTags: ['Java', 'Spring Boot', 'REST API', 'AWS', 'MSA'],
      minYears: 5,
      maxYears: 20,
      yearsSource: 'RANGE',
      rawJobLevel: null,
      isNewcomer: false,
      rawLocations: ['경기 성남시 분당구'],
    });
  });

  it('전체 건수로 페이지 수를 센다', () => {
    expect(mapJumpitList(listPayload).totalPages).toBe(8);
  });

  it('필수 필드가 빠진 항목은 버리되 원시 수신 건수에는 남긴다', () => {
    const result = mapJumpitList({
      result: {
        totalCount: 2,
        positions: [
          listPayload.result.positions[0],
          { id: 2, title: '제목만 있고 회사가 없다' },
        ],
      },
    });
    expect(result.received).toBe(2);
    expect(result.postings).toHaveLength(1);
  });

  it('최상위 구조가 어긋나면 예외를 던진다 — 소스 실패로 다뤄야 한다', () => {
    expect(() => mapJumpitList({ message: '로그인이 필요합니다' })).toThrow();
    expect(() => mapJumpitList('<html>...</html>')).toThrow();
    expect(() => mapJumpitList(null)).toThrow();
  });

  it('공고가 0건인 정상 응답은 예외가 아니다', () => {
    const result = mapJumpitList({ result: { totalCount: 0, positions: [] } });
    expect(result.received).toBe(0);
    expect(result.postings).toEqual([]);
  });
});

describe('mapJumpitDetail', () => {
  // 상세의 techStacks 는 목록과 달리 객체 배열이다. 같은 이름, 다른 형태.
  const detailPayload = {
    result: {
      qualifications: '[자격요건]\n• 백엔드 개발 경력 5년 이상',
      preferredRequirements: '• 대용량 트래픽 경험',
      responsibility: '• Java / Spring Boot 기반 서비스 개발',
      techStacks: [
        { stack: 'Java', imagePath: 'https://cdn.example.test/java.png' },
        { stack: 'Spring Boot', imagePath: 'https://cdn.example.test/sb.png' },
      ],
    },
  };

  it('본문 세 조각을 이어 붙인다', () => {
    const result = mapJumpitDetail(detailPayload);
    expect(result.jdText).toContain('백엔드 개발 경력 5년 이상');
    expect(result.jdText).toContain('대용량 트래픽 경험');
    expect(result.jdText).toContain('Spring Boot 기반 서비스 개발');
  });

  it('객체 배열 형태의 스킬을 문자열로 편다', () => {
    expect(mapJumpitDetail(detailPayload).rawSkillTags).toEqual([
      'Java',
      'Spring Boot',
    ]);
  });

  it('본문 조각이 일부만 있어도 동작한다', () => {
    const result = mapJumpitDetail({
      result: { qualifications: '• 경력 3년 이상' },
    });
    expect(result.jdText).toBe('• 경력 3년 이상');
    expect(result.rawSkillTags).toEqual([]);
  });

  it('최상위 구조가 어긋나면 예외를 던진다', () => {
    expect(() => mapJumpitDetail(null)).toThrow();
  });
});
