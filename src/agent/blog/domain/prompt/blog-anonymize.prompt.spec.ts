import {
  BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT,
  BLOG_ANONYMIZE_SYSTEM_PROMPT,
  selectAnonymizeSystemPrompt,
} from './blog-anonymize.prompt';

const PUBLIC_PROJECT_SOURCE_TYPE = '오늘의 공부';
// 회사용 프롬프트가 공개 프로젝트 글까지 뭉갠 원인 라인. 공개용에는 이 지시가 있으면 안 된다.
const INTERNAL_IDENTIFIER_LINE = '내부 식별자는 역할 설명으로 바꾼다';

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

  it('사내 코드가 재료이므로 내부 식별자 치환 지시를 유지한다', () => {
    expect(BLOG_ANONYMIZE_SYSTEM_PROMPT).toContain(INTERNAL_IDENTIFIER_LINE);
  });
});

describe('BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT', () => {
  // 이 설계의 핵심. 완화 지시를 덧붙이는 것으로는 부족하고 충돌 라인을 제거해야 한다 —
  // 상반된 지시를 아래에 붙이기만 하면 모델이 위 지시를 그대로 지킨다(레포 실측).
  it('내부 식별자 치환 지시를 덧붙이지 않고 제거한다', () => {
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).not.toContain(
      INTERNAL_IDENTIFIER_LINE,
    );
  });

  it('공개 제품명과 글쓴이 본인의 공개 저장소 이름을 보존 대상으로 못박는다', () => {
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).toContain('Slack');
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).toContain('GitHub');
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).toContain(
      '공개 프로젝트에 속한 모듈·클래스·함수·서비스 이름도 보존 대상',
    );
  });

  it('재직 회사 관련 정보는 여전히 제거 대상으로 남긴다', () => {
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).toContain(
      '재직 중인 회사명',
    );
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).toContain('티켓 ID');
  });

  // 두 프롬프트가 같은 파서로 들어간다. 출력 계약이 갈리면 그 출처의 발행만 조용히 깨진다.
  it('회사용과 같은 출력 계약을 쓴다', () => {
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).toContain(
      '{"slug":"영문 kebab-case 3~6단어","description":"한 문장 요약","body":"익명화된 마크다운 본문"}',
    );
    expect(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT).toContain(
      '코드펜스 밖 텍스트 금지',
    );
  });
});

describe('selectAnonymizeSystemPrompt', () => {
  it('오늘의 공부 초안은 공개 프로젝트 계약을 쓴다', () => {
    expect(
      selectAnonymizeSystemPrompt(
        PUBLIC_PROJECT_SOURCE_TYPE,
        PUBLIC_PROJECT_SOURCE_TYPE,
      ),
    ).toBe(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT);
  });

  it('회사 PR 회고 초안은 기존 계약을 그대로 쓴다', () => {
    expect(selectAnonymizeSystemPrompt('PR', PUBLIC_PROJECT_SOURCE_TYPE)).toBe(
      BLOG_ANONYMIZE_SYSTEM_PROMPT,
    );
  });

  // 새 출처가 생겼을 때 조용히 느슨한 쪽을 타면 회사 정보가 샌다. 모르면 엄격한 쪽이다.
  it('출처유형이 비었거나 모르는 값이면 엄격한 회사용으로 떨어진다', () => {
    expect(selectAnonymizeSystemPrompt('', PUBLIC_PROJECT_SOURCE_TYPE)).toBe(
      BLOG_ANONYMIZE_SYSTEM_PROMPT,
    );
    expect(
      selectAnonymizeSystemPrompt('메모', PUBLIC_PROJECT_SOURCE_TYPE),
    ).toBe(BLOG_ANONYMIZE_SYSTEM_PROMPT);
  });

  it('앞뒤 공백이 붙어 와도 같은 출처로 본다', () => {
    expect(
      selectAnonymizeSystemPrompt(
        `  ${PUBLIC_PROJECT_SOURCE_TYPE} `,
        PUBLIC_PROJECT_SOURCE_TYPE,
      ),
    ).toBe(BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT);
  });
});
