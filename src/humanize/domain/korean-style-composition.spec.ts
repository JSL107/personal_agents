import { measureKoreanStyleComposition } from './korean-style-composition';

describe('인용체 세기', () => {
  it.each([
    '공식 문서는 이 값이 필요하다고 설명해요.',
    'README 에 따르면 기본값은 3초예요.',
    'JavaScript reference 의 목록에는 write_todos 가 명시돼 있어요.',
    'LangChain 은 이 방식을 batteries-included 라고 불러요.',
  ])('출처 뒤에 숨은 문장을 센다: %s', (sentence) => {
    expect(
      measureKoreanStyleComposition(sentence).attributionCount,
    ).toBeGreaterThan(0);
  });

  it.each([
    'planning 도구는 write_todos 하나예요.',
    '이 값이 없으면 재시도가 무한히 돌아요.',
    '설명이 필요한 자리라 주석을 남겼어요.',
  ])('사실을 단언한 문장은 세지 않는다: %s', (sentence) => {
    expect(measureKoreanStyleComposition(sentence).attributionCount).toBe(0);
  });

  it('코드블록 안의 문장은 세지 않는다', () => {
    const markdown = [
      '본문이에요.',
      '',
      '```ts',
      '// 문서에 따르면 이 값이 기본이라고 설명해요.',
      '```',
    ].join('\n');
    expect(measureKoreanStyleComposition(markdown).attributionCount).toBe(0);
  });
});

describe('헤딩 명사구 판정', () => {
  const build = (...headings: string[]): string =>
    headings
      .map((heading) => `${heading}\n\n본문 문장이 하나 있어요.`)
      .join('\n\n');

  it('종결어미로 끝나지 않으면 명사구로 센다', () => {
    const metrics = measureKoreanStyleComposition(
      build(
        '## 캐시가 동작하는 방식',
        '## 적용할 수 있는 지점',
        '## 도입 전에 확인할 것',
      ),
    );
    expect(metrics.headingCount).toBe(3);
    expect(metrics.nounPhraseHeadingPercent).toBe(100);
  });

  it('판단을 맺은 문장 제목은 명사구가 아니다', () => {
    const metrics = measureKoreanStyleComposition(
      build(
        '## 만료는 캐시를 버리는 시간이 아니다',
        '## 정책이 갈리는 이유는 하나예요',
        '## 그래서 무엇부터 볼까',
      ),
    );
    expect(metrics.nounPhraseHeadingPercent).toBe(0);
  });

  it('`#` 은 제목이라 세지 않는다', () => {
    // 글 제목은 본문 흐름이 아니다. `##` 이하만 소제목으로 본다.
    const metrics = measureKoreanStyleComposition(
      [
        '# 글 제목입니다',
        '',
        '본문이에요.',
        '',
        '## 첫 절이다',
        '',
        '본문이에요.',
      ].join('\n'),
    );
    expect(metrics.headingCount).toBe(1);
  });
});

describe('리프 절 길이', () => {
  const prose = (chars: number): string => '가'.repeat(chars);

  it('하위 헤딩이 있는 절은 세지 않는다', () => {
    // `## A` 의 길이는 아래 `### B`·`### C` 를 합친 값이라 늘 크게 나온다. 사람이 한 화면에서
    // 읽는 덩어리는 B 와 C 다.
    const markdown = [
      `## 상위 절`,
      prose(100),
      `### 아래 절 하나`,
      prose(200),
      `### 아래 절 둘`,
      prose(300),
    ].join('\n\n');
    const metrics = measureKoreanStyleComposition(markdown);
    expect(metrics.leafSectionCount).toBe(2);
    expect(metrics.longestLeafSectionLength).toBe(300);
  });

  it('코드블록과 목록은 산문 길이에서 뺀다', () => {
    const markdown = [
      '## 절 하나',
      prose(50),
      '',
      '```ts',
      'const x = 1;'.repeat(50),
      '```',
      '',
      '- 목록 항목이 하나 있어요',
      '- 목록 항목이 둘 있어요',
    ].join('\n');
    expect(
      measureKoreanStyleComposition(markdown).longestLeafSectionLength,
    ).toBe(50);
  });
});

describe('확인 범위 표시', () => {
  it.each([
    '아래는 공식 문서를 읽고 정리한 내용이에요.',
    '아직 붙여본 적은 없어요.',
    '직접 돌려본 기록은 아니에요.',
    '확인하지 못한 부분이라 단정은 못 하겠어요.',
  ])('밝힌 글을 찾아낸다: %s', (sentence) => {
    expect(measureKoreanStyleComposition(sentence).hasVerificationScope).toBe(
      true,
    );
  });

  it('밝히지 않은 글은 false 다', () => {
    const markdown = [
      '## 이렇게 붙이면 된다',
      '',
      'ToolExecutionPort 를 세우고 어댑터를 붙이면 돼요. 실행 기록도 함께 남겨요.',
    ].join('\n');
    expect(measureKoreanStyleComposition(markdown).hasVerificationScope).toBe(
      false,
    );
  });
});
