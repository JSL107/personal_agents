import { buildBlogPrompt } from './build-blog-prompt';

describe('buildBlogPrompt', () => {
  it('스킬 명시 호출 prefix + NOTION_URL 출력 지시 + 사용자 요청을 포함한다', () => {
    const prompt = buildBlogPrompt('React 서버컴포넌트 블로그 써줘');
    expect(prompt).toContain('tistory-blog 스킬을 사용해라');
    expect(prompt).toContain('NOTION_URL:');
    expect(prompt).toContain('React 서버컴포넌트 블로그 써줘');
  });

  it('Slack 알림은 요청하지 않는다(이대리가 답장하므로)', () => {
    const prompt = buildBlogPrompt('아무거나');
    expect(prompt).not.toContain('Slack');
    expect(prompt).not.toContain('notify_slack');
  });
});
