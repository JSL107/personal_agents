import { formatBlogDraft } from './blog.formatter';

describe('formatBlogDraft', () => {
  it('summary 가 있으면 제목 줄 바로 아래에 노출한다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '',
      published: true,
      summary: '프롬프트와 RAG의 연결 지점을 정리했습니다.',
    });

    expect(text.split('\n').slice(0, 2)).toEqual([
      '🚀 *블로그 발행 완료*',
      '프롬프트와 RAG의 연결 지점을 정리했습니다.',
    ]);
  });

  it('summary 가 없으면 기존 출력이 유지된다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '',
      published: true,
    });

    expect(text).toBe(
      '🚀 *블로그 발행 완료*\n발행된 글 보기: https://www.notion.so/abc\n_상태=발행 으로 자동 게시됐습니다. 공개 뷰에서 바로 확인하세요._',
    );
  });

  it('summary 의 Slack mrkdwn 제어문자를 escape 한다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '',
      published: true,
      summary: '<RAG> & 프롬프트',
    });

    expect(text).toContain('&lt;RAG&gt; &amp; 프롬프트');
    expect(text).not.toContain('<RAG> & 프롬프트');
  });

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

  it('publishError 가 있으면 실패 사실과 이유를 노출한다 (조용한 실패 방지)', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '',
      published: false,
      publishError: 'property "상태" does not exist',
    });
    expect(text).toContain('발행 상태 전환에 실패');
    expect(text).toContain('property "상태" does not exist');
    // 실패인데 정상 초안 생성처럼 읽히면 안 된다.
    expect(text).not.toContain('초안만 생성');
  });

  it('publishError 가 길거나 mrkdwn 제어문자를 포함해도 안전하게 자른다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '',
      published: false,
      publishError: `<script>&${'x'.repeat(300)}`,
    });
    expect(text).toContain('&lt;script&gt;&amp;');
    expect(text).not.toContain('<script>');
    expect(text).toContain('…');
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
