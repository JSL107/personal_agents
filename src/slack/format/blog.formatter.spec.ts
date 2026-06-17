import { formatBlogDraft } from './blog.formatter';

describe('formatBlogDraft', () => {
  it('published=true 면 발행 완료 메시지 + 링크를 노출한다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '제목: HTTP 캐시 정리\n본문…',
      published: true,
    });
    expect(text).toContain('블로그 발행 완료');
    expect(text).toContain('https://www.notion.so/abc');
    expect(text).not.toContain('초안만 생성');
  });

  it('published=false 면 초안 완성 + 수동 발행 안내 메시지를 만든다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '제목: HTTP 캐시 정리\n본문…',
      published: false,
    });
    expect(text).toContain('블로그 초안 완성');
    expect(text).toContain('초안만 생성');
    expect(text).toContain('https://www.notion.so/abc');
  });

  it('안전하지 않은(http/https 아닌) URL 은 링크로 노출하지 않는다', () => {
    const text = formatBlogDraft({
      notionUrl: 'javascript:alert(1)',
      rawOutput: '',
      published: false,
    });
    expect(text).not.toContain('javascript:');
  });
});
