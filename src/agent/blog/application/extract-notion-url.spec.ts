import { extractNotionUrl } from './extract-notion-url';

describe('extractNotionUrl', () => {
  it('NOTION_URL: 마커를 우선 추출한다', () => {
    const out = '작업 완료.\nNOTION_URL: https://www.notion.so/abc123\n끝.';
    expect(extractNotionUrl(out)).toBe('https://www.notion.so/abc123');
  });

  it('마커가 없으면 본문의 notion URL 을 추출한다', () => {
    const out = 'Notion 페이지: https://app.notion.com/p/HTTP-Cache-37c6 입니다.';
    expect(extractNotionUrl(out)).toBe('https://app.notion.com/p/HTTP-Cache-37c6');
  });

  it('notion URL 이 없으면 null', () => {
    expect(extractNotionUrl('초안만 작성했고 링크 없음')).toBeNull();
  });

  it('여러 개면 마지막 마커 값을 쓴다', () => {
    const out =
      'NOTION_URL: https://notion.so/old\nNOTION_URL: https://notion.so/new';
    expect(extractNotionUrl(out)).toBe('https://notion.so/new');
  });
});
