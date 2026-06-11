import { formatBlogDraft } from './blog.formatter';

describe('formatBlogDraft', () => {
  it('Notion 링크를 포함한 완료 메시지를 만든다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '제목: HTTP 캐시 정리\n본문…',
    });
    expect(text).toContain('블로그 초안');
    expect(text).toContain('https://www.notion.so/abc');
  });

  it('안전하지 않은(http/https 아닌) URL 은 링크로 노출하지 않는다', () => {
    const text = formatBlogDraft({
      notionUrl: 'javascript:alert(1)',
      rawOutput: '',
    });
    expect(text).not.toContain('javascript:');
  });
});
