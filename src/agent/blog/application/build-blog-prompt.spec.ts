import { buildBlogPrompt } from './build-blog-prompt';

describe('buildBlogPrompt', () => {
  it('스킬 명시 호출 prefix + NOTION_URL 출력 지시 + 사용자 요청을 포함한다', () => {
    const prompt = buildBlogPrompt('React 서버컴포넌트 블로그 써줘');
    expect(prompt).toContain('tistory-blog 스킬을 사용해라');
    expect(prompt).toContain('NOTION_URL:');
    expect(prompt).toContain('TAGS:');
    expect(prompt).toContain('SUMMARY:');
    expect(prompt).toContain('React 서버컴포넌트 블로그 써줘');
  });

  it('Slack 알림은 요청하지 않는다(이대리가 답장하므로)', () => {
    const prompt = buildBlogPrompt('아무거나');
    expect(prompt).not.toContain('Slack');
    expect(prompt).not.toContain('notify_slack');
  });

  it('통합 채점표의 흐름·근거·자연스러움 기준을 생성 프롬프트에 적용한다', () => {
    const prompt = buildBlogPrompt('루프 엔지니어링 글을 써줘');

    for (const rule of [
      '문제→접근→결과→교훈',
      '공식·1차 출처',
      '문장의 호흡을 무조건 짧게 만들지 않는다',
      '임의로 줄바꿈하지 않는다',
      '마침표만 붙여 나열하지 않는다',
      '실험·체크리스트·후속 읽을거리',
    ]) {
      expect(prompt).toContain(rule);
    }
  });
});
