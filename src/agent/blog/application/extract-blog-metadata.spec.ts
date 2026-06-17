import {
  extractSummary,
  extractTags,
  notionPageIdFromUrl,
} from './extract-blog-metadata';

describe('extractTags', () => {
  it('TAGS 마커를 콤마 split + trim 한다', () => {
    expect(extractTags('TAGS: NestJS, Notion , BullMQ')).toEqual([
      'NestJS',
      'Notion',
      'BullMQ',
    ]);
  });

  it('마커 없으면 빈 배열', () => {
    expect(extractTags('태그 없음')).toEqual([]);
  });

  it('최대 5개로 자르고 빈 항목 제거', () => {
    expect(extractTags('TAGS: a, , b, c, d, e, f, g')).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });
});

describe('extractSummary', () => {
  it('SUMMARY 마커 한 줄을 추출한다', () => {
    expect(extractSummary('SUMMARY: 두세 문장 요약입니다.')).toBe(
      '두세 문장 요약입니다.',
    );
  });

  it('마커 없으면 null', () => {
    expect(extractSummary('요약 없음')).toBeNull();
  });
});

describe('notionPageIdFromUrl', () => {
  it('32-hex page id 를 추출한다', () => {
    const id = '2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
    expect(notionPageIdFromUrl(`https://notion.so/Title-${id}`)).toBe(id);
  });

  it('dashed UUID 형식도 추출한다', () => {
    const id = '2a1b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
    expect(notionPageIdFromUrl(`https://www.notion.so/${id}`)).toBe(id);
  });

  it('id 없으면 null', () => {
    expect(notionPageIdFromUrl('https://notion.so/x')).toBeNull();
  });
});
