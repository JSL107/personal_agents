import {
  breakProseIntoSentences,
  convertMarkdownBold,
  linkifyBareUrls,
} from './mrkdwn.util';

describe('breakProseIntoSentences', () => {
  // 실제 PM 산출물과 같은 모양 — 문장마다 링크가 붙는다. 링크 없는 짧은 표본으로 재면
  // 화면 길이 판정이 실사용과 어긋난다.
  const longProse =
    '현재 assigned이고 전일에도 미완료였던 PR #52를 마무리 최우선 작업으로 정했다 (<https://github.com/o/sbe-api-v5-puppeteer/pull/52|sbe-api-v5-puppeteer #52>). PR #1017은 5일 연속 정체돼 오늘 실행 목록에서 뺐다(<https://github.com/o/sbe-api-v5/pull/1017|sbe-api-v5 #1017>). 신규 assigned PR #994는 오전 집중 작업으로 배치했다 (<https://github.com/o/sbe-api-v5/pull/994|sbe-api-v5 #994>).';

  it('긴 산문을 문장 끝에서 줄바꿈한다', () => {
    expect(breakProseIntoSentences(longProse).split('\n')).toHaveLength(3);
  });

  it('링크 안의 마침표는 문장 끝으로 보지 않는다', () => {
    const withDottedLink =
      '앞 문장을 충분히 길게 늘려 임계값을 넘긴다 (<https://a.b.c/x. y|이름 v1. 2>) 이렇게 이어서 쓰면 링크 안 마침표가 살아 있어야 한다. 뒷 문장.';

    expect(breakProseIntoSentences(withDottedLink)).toContain(
      '<https://a.b.c/x. y|이름 v1. 2>',
    );
  });

  it('기호 없이 들여쓴 긴 줄도 상위 항목에 딸린 줄이라 쪼개지 않는다', () => {
    const line =
      '      → 오늘 할 일에서 빼고 백로그로 분리한다. 다음 주 계획 회의에서 다시 우선순위를 정할 때 함께 살펴본다. 그전까지는 담당 목록에서도 내려 두고, 관련 알림도 함께 꺼서 오늘 집중할 일이 흐트러지지 않게 한다.';
    const indented = line.replace('→ ', '');
    expect(breakProseIntoSentences(line)).toBe(line);
    expect(breakProseIntoSentences(indented)).toBe(indented);
  });

  it('목록·인용 줄과 짧은 줄은 건드리지 않는다', () => {
    const untouched = [
      `• ${longProse}`,
      `> ${longProse}`,
      '짧은 안내. 그대로 둔다.',
      '*판단 근거*: 짧으면 안 쪼갠다.',
    ].join('\n');

    expect(breakProseIntoSentences(untouched)).toBe(untouched);
  });

  it('`*굵게*` 로 시작하는 긴 산문은 목록이 아니므로 쪼갠다', () => {
    const result = breakProseIntoSentences(`*판단 근거*: ${longProse}`);

    expect(result.split('\n')).toHaveLength(3);
  });
});

describe('breakProseIntoSentences — 짧은 문장 병합', () => {
  it('한 줄을 못 채우는 짧은 문장은 이웃과 붙여 둔다', () => {
    const mixed =
      '확인했다. 전일 미완료였던 PR #52 를 오늘의 마무리 최우선 작업으로 정하고 관련 검증 항목을 함께 묶었다. 완료.';

    expect(breakProseIntoSentences(mixed)).toBe(mixed);
  });

  it('충분히 긴 문장끼리는 각각 한 줄로 선다', () => {
    const lines = breakProseIntoSentences(
      [
        '전일 미완료였던 PR #52 를 오늘의 마무리 최우선 작업으로 정하고 검증 항목을 묶었다.',
        'PR #1017 은 닷새 연속 정체돼 오늘 실행 목록에서는 일단 제외하기로 판단했다.',
        '신규로 배정된 PR #994 는 집중력이 높은 오전 시간대에 배치해 두었다.',
      ].join(' '),
    ).split('\n');

    expect(lines).toHaveLength(3);
  });

  it('길이는 주소가 아니라 화면에 보이는 이름으로 잰다', () => {
    // 링크 원문은 길지만 화면에 보이는 건 `r #52` 뿐 — 짧은 문장으로 봐야 한다.
    const withLink =
      '<https://github.com/owner/repository-with-a-very-long-name/pull/52|r #52>. 전일 미완료였던 PR 을 오늘의 마무리 최우선 작업으로 정하고 검증 항목을 함께 묶어 두었다.';

    expect(breakProseIntoSentences(withLink).split('\n')).toHaveLength(1);
  });
});

describe('breakProseIntoSentences — 코드블록 보호', () => {
  it('코드블록 안의 긴 줄은 문장 단위로 쪼개지 않는다', () => {
    const codeLine =
      'const outcome = await service.execute({ id, name }); // 아주 긴 주석. 두 번째 문장까지 붙어 있어 임계값을 넘긴다. 세 번째 문장.';
    const source = ['```ts', codeLine, '```'].join('\n');

    expect(breakProseIntoSentences(source)).toBe(source);
  });

  it('코드블록 밖의 산문은 그대로 쪼갠다', () => {
    const prose = [
      '전일 미완료였던 PR #52 를 오늘의 마무리 최우선 작업으로 정하고 검증 항목을 묶었다.',
      'PR #1017 은 닷새 연속 정체돼 오늘 실행 목록에서는 제외하기로 판단했다.',
      '신규로 배정된 PR #994 는 집중력이 높은 오전 시간대에 배치해 두었다.',
    ].join(' ');
    const source = ['```ts', 'const a = 1;', '```', prose].join('\n');
    const result = breakProseIntoSentences(source);

    expect(result).toContain('```ts\nconst a = 1;\n```');
    // fence 3 줄은 그대로, 산문만 문장 3 줄로 갈린다.
    expect(result.split('\n')).toHaveLength(6);
  });
});

describe('linkifyBareUrls — 코드 영역 보존', () => {
  it('코드블록 안 주소는 한 글자도 바꾸지 않는다', () => {
    const source = [
      '*변경 안내*',
      '```ts',
      "const pr = 'https://github.com/o/r/pull/1';",
      '```',
    ].join('\n');

    expect(linkifyBareUrls(source)).toBe(source);
  });

  it('인라인 코드 안 주소도 그대로 둔다', () => {
    // 백틱이 링크 문법 안으로 말려 들어가면 `<https://...`|r #2> 처럼 통째로 깨진다.
    const source = '참고: `https://github.com/o/r/pull/2` 를 보세요.';

    expect(linkifyBareUrls(source)).toBe(source);
  });

  it('코드 밖 주소는 그대로 접는다', () => {
    const source = [
      '```ts',
      'const a = 1;',
      '```',
      '근거: https://github.com/o/r/pull/3 참고.',
    ].join('\n');

    expect(linkifyBareUrls(source)).toContain(
      '<https://github.com/o/r/pull/3|r #3>',
    );
  });
});

describe('breakProseIntoSentences — 인라인 코드 보존', () => {
  it('인라인 코드 안 마침표는 문장 끝으로 보지 않는다', () => {
    const source =
      '설정 파일 `a. b. c` 안의 값을 오늘 자로 갱신하고 관련 검증 항목을 함께 묶어 두었다. 뒷 문장도 충분히 길게 이어 붙여 임계값을 넘긴다.';

    expect(breakProseIntoSentences(source)).toContain('`a. b. c`');
  });
});

describe('convertMarkdownBold', () => {
  it('Markdown 굵게를 Slack 굵게로 바꾼다', () => {
    expect(convertMarkdownBold('**이유는 확인할 수 없어요.** 다만')).toBe(
      '*이유는 확인할 수 없어요.* 다만',
    );
  });

  it('바로 붙은 글자가 있으면 굵게 표시만 걷어낸다 — Slack 이 그리지 못한다', () => {
    expect(convertMarkdownBold('**한 개만 나왔는지**는 몰라요')).toBe(
      '한 개만 나왔는지는 몰라요',
    );
  });

  it('맨 URL 안의 `**` 는 주소의 일부라 건드리지 않는다', () => {
    expect(convertMarkdownBold('https://x.test/a**b**c 와 **굵게**')).toBe(
      'https://x.test/a**b**c 와 *굵게*',
    );
  });

  // 2026-10-30 실제 DM: 코드가 굵게 가운데 끼면 여는·닫는 `**` 가 서로 다른 조각으로 나뉘어 별표가 그대로 보였다.
  it('굵게 안에 인라인 코드가 끼어 있어도 Slack 굵게로 바꾼다', () => {
    expect(
      convertMarkdownBold(
        '사진은 **오늘 브리핑에서 `dontallow` 하나만 선정됐기 때문** 이에요.',
      ),
    ).toBe('사진은 *오늘 브리핑에서 `dontallow` 하나만 선정됐기 때문* 이에요.');
  });

  it('굵게 안에 코드가 끼고 바로 글자가 붙으면 굵게 표시만 걷어낸다', () => {
    expect(
      convertMarkdownBold('**`dontallow` 하나만 선정됐기 때문**이에요.'),
    ).toBe('`dontallow` 하나만 선정됐기 때문이에요.');
  });

  it('굵게 안의 Slack 링크는 그대로 두고 굵게만 바꾼다', () => {
    expect(
      convertMarkdownBold('**<https://x.test|기록> 을 보세요** 다만'),
    ).toBe('*<https://x.test|기록> 을 보세요* 다만');
  });

  it('코드블록과 인라인 코드 안의 별표는 건드리지 않는다', () => {
    const source = '```\n**raw**\n```\n`a**b**c` 와 **굵게**';
    expect(convertMarkdownBold(source)).toBe(
      '```\n**raw**\n```\n`a**b**c` 와 *굵게*',
    );
  });
});

describe('코드 보호 — `~~~` 펜스와 이중 백틱', () => {
  it('`~~~` 코드블록 안은 바꾸지 않는다', () => {
    const source = '~~~\n**raw** https://github.com/o/r/pull/2\n~~~\n**굵게**';
    expect(convertMarkdownBold(linkifyBareUrls(source))).toBe(
      '~~~\n**raw** https://github.com/o/r/pull/2\n~~~\n*굵게*',
    );
  });

  it('``` 블록 안의 `~~~` 줄은 블록을 닫지 않는다', () => {
    const source = '```\n~~~\n**raw**\n```\n**굵게**';
    expect(convertMarkdownBold(source)).toBe('```\n~~~\n**raw**\n```\n*굵게*');
  });

  it('열린 블록 안의 `~~~js`·` ```js ` 줄은 블록을 닫지 않는다', () => {
    expect(convertMarkdownBold('~~~\n~~~js\n**raw**\n~~~\n**굵게**')).toBe(
      '~~~\n~~~js\n**raw**\n~~~\n*굵게*',
    );
    expect(convertMarkdownBold('```\n```js\n**raw**\n```\n**굵게**')).toBe(
      '```\n```js\n**raw**\n```\n*굵게*',
    );
  });

  it('이중 백틱 안의 GitHub 주소는 링크로 접지 않는다', () => {
    const source = '``https://github.com/o/r/pull/2``';
    expect(linkifyBareUrls(source)).toBe(source);
  });

  it('이중 백틱 인라인 코드 안은 바꾸지 않는다 — 안에 백틱이 있어도', () => {
    expect(convertMarkdownBold('``a `x` **b**`` 와 **굵게**')).toBe(
      '``a `x` **b**`` 와 *굵게*',
    );
  });
});
