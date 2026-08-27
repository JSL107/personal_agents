import { mapRallitList } from './rallit.mapper';

// 2026-08-27 실제 응답 표본.
const payload = {
  statusCode: 'SUCCESS',
  data: {
    pageNumber: 1,
    pageSize: 20,
    totalCount: 301,
    totalPage: 16,
    items: [
      {
        id: 2691,
        title: '[인재풀] 전 직군',
        jobLevel: 'IRRELEVANT',
        jobLevels: ['IRRELEVANT'],
        companyId: 7,
        companyName: '인프랩 (인프런)',
        addressRegion: 'PANGYO',
        jobSkillKeywords: ['MS-Office', 'Slack'],
        status: { code: 'HIRING', name: '모집 중' },
        url: 'https://www.rallit.com/positions/2691',
      },
      {
        id: 3001,
        title: '백엔드 개발자',
        jobLevel: 'MIDDLE',
        jobLevels: ['MIDDLE'],
        companyId: 9,
        companyName: '토스',
        addressRegion: 'GANGNAM',
        jobSkillKeywords: ['Java', 'Spring Boot'],
        status: { code: 'HIRING', name: '모집 중' },
        url: 'https://www.rallit.com/positions/3001',
      },
    ],
  },
};

describe('mapRallitList', () => {
  it('실측 응답에서 공고를 뽑아낸다', () => {
    const result = mapRallitList(payload);
    expect(result.received).toBe(2);
    expect(result.postings).toHaveLength(2);
    expect(result.postings[1]).toEqual({
      source: 'rallit',
      sourceId: '3001',
      company: '토스',
      title: '백엔드 개발자',
      detailUrl: 'https://www.rallit.com/positions/3001',
      rawSkillTags: ['Java', 'Spring Boot'],
      minYears: 3,
      maxYears: 7,
      yearsSource: 'LEVEL',
      rawJobLevel: 'MIDDLE',
      isNewcomer: false,
      rawLocations: ['GANGNAM'],
    });
  });

  it('등급을 연차 구간으로 옮기고 원본 등급을 남긴다', () => {
    const [first] = mapRallitList(payload).postings;
    expect(first.minYears).toBeNull();
    expect(first.maxYears).toBeNull();
    expect(first.rawJobLevel).toBe('IRRELEVANT');
    expect(first.yearsSource).toBe('LEVEL');
  });

  it('BEGINNER 는 신입 표식을 세운다', () => {
    const result = mapRallitList({
      data: {
        totalCount: 1,
        totalPage: 1,
        items: [
          {
            id: 5,
            title: '신입 백엔드',
            jobLevel: 'BEGINNER',
            companyName: '회사',
            addressRegion: 'SEOUL',
            jobSkillKeywords: [],
            url: 'https://www.rallit.com/positions/5',
          },
        ],
      },
    });
    expect(result.postings[0].isNewcomer).toBe(true);
  });

  it('url 이 없으면 id 로 상세 주소를 만든다', () => {
    const result = mapRallitList({
      data: {
        totalCount: 1,
        totalPage: 1,
        items: [
          {
            id: 77,
            title: '백엔드',
            jobLevel: 'JUNIOR',
            companyName: '회사',
            addressRegion: 'SEOUL',
            jobSkillKeywords: [],
          },
        ],
      },
    });
    expect(result.postings[0].detailUrl).toBe(
      'https://www.rallit.com/positions/77',
    );
  });

  it('필수 필드가 빠진 항목은 버리되 원시 수신 건수에는 남긴다', () => {
    const result = mapRallitList({
      data: {
        totalCount: 2,
        totalPage: 1,
        items: [payload.data.items[1], { id: 9 }],
      },
    });
    expect(result.received).toBe(2);
    expect(result.postings).toHaveLength(1);
  });

  it('최상위 구조가 어긋나면 예외를 던진다', () => {
    expect(() => mapRallitList({ statusCode: 'BAD_PARAMETER' })).toThrow();
    expect(() => mapRallitList(null)).toThrow();
  });

  it('전체 페이지 수를 응답에서 그대로 읽는다', () => {
    expect(mapRallitList(payload).totalPages).toBe(16);
  });
});
