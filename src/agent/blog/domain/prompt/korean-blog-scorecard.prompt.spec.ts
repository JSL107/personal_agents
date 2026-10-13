import {
  KOREAN_BLOG_CONTENT_RULES,
  KOREAN_BLOG_SCORECARD_PROMPT,
} from './korean-blog-scorecard.prompt';

const lines = (prompt: string): string[] => prompt.split('\n');

describe('KOREAN_BLOG_SCORECARD_PROMPT', () => {
  // 항목을 이름 붙여 조합하는 구조로 바꾸면서, 항목이 빠지거나 순서가 흔들려도 아무 데서도
  // 드러나지 않게 됐다. 이 상수를 쓰는 두 경로(Hermes 릴레이·회고 초안)에는 뒤따르는 검증이
  // 없어, 어긋나면 발행된 글에서야 보인다.
  it('항목 11개를 예전 순서 그대로 유지한다', () => {
    const all = lines(KOREAN_BLOG_SCORECARD_PROMPT);

    expect(all).toHaveLength(11);
    // 앞뒤 경계와 문체 항목의 자리를 못박는다. 순서가 밀리면 여기서 걸린다.
    expect(all[0]).toContain('한국어 기술 블로그 통합 채점표의 기준을 따른다');
    expect(all[5]).toContain('사실 하나를 말할 때마다 마침표를 찍지 마라');
    expect(all[6]).toContain('임의로 줄바꿈하지 않는다');
    expect(all[9]).toContain('마침표만 붙여 나열하지 않는다');
    expect(all[10]).toContain('마지막에는 처음 제기한 문제에 답하고');
  });

  // 호흡 항목은 같은 입력 반복 실측에 쓴 문장 그대로여야 한다(소스 주석). 첫 문장만 보면
  // 연결어미·섞기 지시가 빠지거나 다듬어져도 통과해, 잰 것과 다른 문장이 나간다.
  it('호흡 항목은 실측에 쓴 문장 전체를 그대로 담는다', () => {
    expect(lines(KOREAN_BLOG_SCORECARD_PROMPT)[5]).toBe(
      '사실 하나를 말할 때마다 마침표를 찍지 마라. 원인과 결과, 시도와 그 결과, 조건과 예외처럼 서로 기대는 내용은 연결어미(~해서, ~했는데, ~하자, ~면서)로 이어 한 문장에 담는다. 짧은 문장은 강조하거나 결론을 끊어 줄 때만 쓰고, 한 문단 안에 짧게 끊은 문장과 길게 이어 쓴 문장이 함께 있게 한다.',
    );
  });
});

describe('KOREAN_BLOG_CONTENT_RULES', () => {
  it('전체 채점표의 부분집합이다', () => {
    const all = lines(KOREAN_BLOG_SCORECARD_PROMPT);

    for (const line of lines(KOREAN_BLOG_CONTENT_RULES)) {
      expect(all).toContain(line);
    }
  });

  it('윤문 단계가 담당하는 문체 항목을 담지 않는다', () => {
    // 이 상수를 받는 경로는 생성 뒤 humanizeMarkdownProse 를 지난다. 같은 규칙이 윤문
    // 프롬프트(humanize-system.prompt.ts:449-451,461)에 이미 있어 두 번 적용된다.
    const content = KOREAN_BLOG_CONTENT_RULES;

    expect(content).not.toContain('사실 하나를 말할 때마다 마침표를 찍지 마라');
    expect(content).not.toContain('임의로 줄바꿈하지 않는다');
    expect(content).not.toContain('마침표만 붙여 나열하지 않는다');
  });

  it('채점표 전체를 가리키는 메타 문장을 담지 않는다', () => {
    // 「문맥 흐름, 표현 방식, 글 전개, 한국어 자연스러움, 기술 근거를 모두 챙긴다」는 덜어낸
    // 문체 축까지 도로 불러온다. 이 한 줄이 있으면 분리한 의미가 없어진다.
    expect(KOREAN_BLOG_CONTENT_RULES).not.toContain('한국어 자연스러움');
  });
});
