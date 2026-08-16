import { BLOG_ANONYMIZE_SYSTEM_PROMPT } from './blog-anonymize.prompt';

describe('BLOG_ANONYMIZE_SYSTEM_PROMPT', () => {
  it('slug, description, body만 가진 JSON 출력 계약을 요구한다', () => {
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('JSON');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('"slug"');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('"description"');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('"body"');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('코드펜스 밖 텍스트 금지');
  });

  it('식별정보 제거와 기술 맥락 보존 경계를 명시한다', () => {
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('회사명');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('티켓 ID');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('PHP');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('Node');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('HTTP 상태코드');
  });

  it('사실 추가·교훈 삭제·20% 초과 축약을 금지한다', () => {
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('사실 왜곡');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('없던 내용 추가');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('교훈 문단 삭제');
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain('80% 미만');
  });
});
