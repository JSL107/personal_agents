import { measureKoreanStyleComposition } from './korean-style-composition';

describe('인용체 세기', () => {
  it.each([
    '공식 문서는 이 값이 필요하다고 설명해요.',
    'README 에 따르면 기본값은 3초예요.',
    'JavaScript reference 의 목록에는 write_todos 가 명시돼 있어요.',
    'LangChain 블로그는 이 방식을 batteries-included 라고 불러요.',
  ])('출처 뒤에 숨은 문장을 센다: %s', (sentence) => {
    expect(
      measureKoreanStyleComposition(sentence).attributionCount,
    ).toBeGreaterThan(0);
  });

  it.each([
    '이 패턴을 어댑터라고 해요.',
    '이걸 트랜잭션이라고 불러요.',
    'planning 도구는 write_todos 하나예요.',
    '이 값이 없으면 재시도가 무한히 돌아요.',
    '설명이 필요한 자리라 주석을 남겼어요.',
  ])('사실을 단언한 문장은 세지 않는다: %s', (sentence) => {
    expect(measureKoreanStyleComposition(sentence).attributionCount).toBe(0);
  });

  it('출처 이름만 있고 매체가 없으면 못 잡는다 (알려진 한계)', () => {
    // 「LangChain 은 ~라고 불러요」처럼 회사·제품 이름이 주어인 문장은 놓친다. 출처 이름은
    // 무한해서 목록으로 담을 수 없고, 「~라고 불러요」만으로 잡으면 「이 패턴을 어댑터라고
    // 해요」 같은 정의문까지 걸린다. 놓치는 쪽을 골랐고, 상한을 그만큼 낮게 뒀다.
    expect(
      measureKoreanStyleComposition(
        'LangChain 은 이 방식을 batteries-included 라고 불러요.',
      ).attributionCount,
    ).toBe(0);
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

  it.each(['## 인프라', '## 연산자', '## 개요'])(
    '명사로 끝나는 제목은 명사구다: %s',
    (heading) => {
      // `라`·`자`·`요` 한 글자로 보면 이런 명사가 문장형으로 잡힌다.
      expect(
        measureKoreanStyleComposition(build(heading)).nounPhraseHeadingPercent,
      ).toBe(100);
    },
  );

  it.each(['## 왜 필요한가', '## 무엇이 달라지는가'])(
    '의문형은 문장으로 센다: %s',
    (heading) => {
      expect(
        measureKoreanStyleComposition(build(heading)).nounPhraseHeadingPercent,
      ).toBe(0);
    },
  );

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

  it('하위 헤딩이 있는 절도 자체 산문을 센다', () => {
    // `splitByHeadings` 가 이미 다음 헤딩 전까지만 자르므로 상위 절의 body 에는 하위 절이 섞이지
    // 않는다. 건너뛰면 `## A` 아래 쓴 분량이 통째로 사라진다(리뷰 지적).
    const markdown = [
      `## 상위 절`,
      prose(100),
      `### 아래 절 하나`,
      prose(200),
      `### 아래 절 둘`,
      prose(300),
    ].join('\n\n');
    const metrics = measureKoreanStyleComposition(markdown);
    expect(metrics.sectionCount).toBe(3);
    expect(metrics.longestSectionProse).toBe(300);
  });

  it('상위 절에만 긴 산문이 있어도 잡는다', () => {
    const markdown = [`## 상위 절`, prose(500), `### 아래 절`, prose(100)].join(
      '\n\n',
    );
    expect(measureKoreanStyleComposition(markdown).longestSectionProse).toBe(
      500,
    );
  });

  it('강조로 시작하는 줄을 목록으로 보지 않는다', () => {
    // 마커 뒤 공백을 선택으로 두면 `**핵심은…**` 이 목록으로 오인돼 절 길이에서 빠진다.
    const emphasised = [
      '## 절',
      '**핵심은 이렇습니다.** 설명이 이어져요.',
    ].join('\n\n');
    const plain = ['## 절', '핵심은 이렇습니다. 설명이 이어져요.'].join('\n\n');
    expect(
      measureKoreanStyleComposition(emphasised).longestSectionProse,
    ).toBeGreaterThan(0);
    expect(measureKoreanStyleComposition(plain).longestSectionProse).toBe(
      measureKoreanStyleComposition(emphasised).longestSectionProse - 4,
    );
  });

  it.each(['- 항목이에요', '1. 항목이에요', '1) 항목이에요', '| 셀 |'])(
    '목록과 표는 산문에서 뺀다: %s',
    (line) => {
      expect(
        measureKoreanStyleComposition(['## 절', line].join('\n\n'))
          .longestSectionProse,
      ).toBe(0);
    },
  );

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
    expect(measureKoreanStyleComposition(markdown).longestSectionProse).toBe(
      50,
    );
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
