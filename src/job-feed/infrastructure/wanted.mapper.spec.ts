import { mapWantedDetail, mapWantedList } from './wanted.mapper';

// 2026-08-27 실제 응답 표본. 목록에는 skill_tags 가 없다 — 상세에만 있다.
const listPayload = {
  data: [
    {
      id: 382928,
      position: '백엔드 개발자',
      company: { id: 28096, name: '로위랩코리아' },
      annual_from: 3,
      annual_to: 5,
      address: { location_key: 'seoul', location: '서울', district: '강남구' },
      status: 'active',
    },
    {
      id: 400001,
      position: '서버 개발자',
      company: { id: 1, name: '통로이미지' },
      annual_from: 7,
      annual_to: 100,
      address: { location_key: 'seoul', location: '서울', district: '중구' },
      status: 'active',
    },
  ],
};

describe('mapWantedList', () => {
  it('실측 응답에서 공고를 뽑아낸다', () => {
    const result = mapWantedList(listPayload);
    expect(result.received).toBe(2);
    expect(result.postings[0]).toEqual({
      source: 'wanted',
      sourceId: '382928',
      company: '로위랩코리아',
      title: '백엔드 개발자',
      detailUrl: 'https://www.wanted.co.kr/wd/382928',
      rawSkillTags: [],
      minYears: 3,
      maxYears: 5,
      yearsSource: 'RANGE',
      rawJobLevel: null,
      isNewcomer: false,
      rawLocations: ['서울'],
    });
  });

  it('annual_to 100 은 상한 없음이라 null 로 바꾼다', () => {
    const [, second] = mapWantedList(listPayload).postings;
    expect(second.minYears).toBe(7);
    expect(second.maxYears).toBeNull();
  });

  it('목록에는 스킬이 없으므로 빈 배열이다 — 상세에서 채운다', () => {
    expect(mapWantedList(listPayload).postings[0].rawSkillTags).toEqual([]);
  });

  it('회사 정보가 빠진 항목은 버리되 원시 수신 건수에는 남긴다', () => {
    const result = mapWantedList({
      data: [listPayload.data[0], { id: 5, position: '제목만' }],
    });
    expect(result.received).toBe(2);
    expect(result.postings).toHaveLength(1);
  });

  it('최상위 구조가 어긋나면 예외를 던진다', () => {
    expect(() => mapWantedList({ message: 'error' })).toThrow();
    expect(() => mapWantedList(null)).toThrow();
  });

  it('0건 정상 응답은 예외가 아니다', () => {
    expect(mapWantedList({ data: [] }).postings).toEqual([]);
  });
});

describe('mapWantedDetail', () => {
  const detailPayload = {
    job: {
      skill_tags: [
        { title: 'Java', id: 1, kind_title: 'SKILL' },
        { title: 'Spring', id: 2, kind_title: 'SKILL' },
      ],
      detail: {
        requirements: '• 백엔드 개발 경력 3년 이상',
        main_tasks: '• API 설계 및 개발',
        preferred_points: '• 대용량 트래픽 경험',
        intro: '회사 소개',
        benefits: '복지',
      },
    },
  };

  it('본문 세 조각을 이어 붙인다 — 회사 소개와 복지는 넣지 않는다', () => {
    const result = mapWantedDetail(detailPayload);
    expect(result.jdText).toContain('API 설계 및 개발');
    expect(result.jdText).toContain('백엔드 개발 경력 3년 이상');
    expect(result.jdText).toContain('대용량 트래픽 경험');
    expect(result.jdText).not.toContain('회사 소개');
    expect(result.jdText).not.toContain('복지');
  });

  it('스킬 태그의 title 만 뽑는다', () => {
    expect(mapWantedDetail(detailPayload).rawSkillTags).toEqual([
      'Java',
      'Spring',
    ]);
  });

  it('최상위 구조가 어긋나면 예외를 던진다', () => {
    expect(() => mapWantedDetail({ data: {} })).toThrow();
  });
});
