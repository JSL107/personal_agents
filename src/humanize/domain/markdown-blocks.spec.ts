import {
  CODE_MASK_PATTERN,
  countMarkdownStructure,
  maskFencedCodeBlocks,
  restoreFencedCodeBlocks,
  scanMarkdownBlocks,
  stripStructuralEmDashes,
} from './markdown-blocks';

const markdown = [
  '## 문제',
  '',
  '레거시에서 이렇게 조회했다. 매번 전체를 읽어왔다.',
  '',
  '```php',
  '$row = query("SELECT 1");',
  '',
  '// 위 빈 줄이 블록을 쪼개면 코드가 문단으로 새어 나간다',
  '```',
  '',
  '| 항목 | 값 |',
  '| --- | --- |',
  '| 지연 | 1.2s |',
  '',
  '> 인용은 손대지 않는다',
  '',
  '- 목록도 그대로 둔다',
  '',
  '교훈은 하나다. 원장을 먼저 남긴다.',
].join('\n');

describe('scanMarkdownBlocks — 산문과 보존 블록 가르기', () => {
  it('코드펜스 안의 빈 줄이 블록을 쪼개지 않는다', () => {
    const { lines, blocks } = scanMarkdownBlocks(markdown);
    const fence = blocks.find((block) => lines[block.startLine] === '```php');

    expect(fence).toBeDefined();
    expect(fence?.kind).toBe('keep');
    // 펜스 시작줄부터 닫는 줄까지 한 블록
    expect(lines[fence?.endLine ?? -1]).toBe('```');
  });

  it('헤딩·표·인용·목록은 keep, 평문 문단만 prose 로 잡는다', () => {
    const { lines, blocks } = scanMarkdownBlocks(markdown);
    const proseTexts = blocks
      .filter((block) => block.kind === 'prose')
      .map((block) =>
        lines.slice(block.startLine, block.endLine + 1).join('\n'),
      );

    expect(proseTexts).toEqual([
      '레거시에서 이렇게 조회했다. 매번 전체를 읽어왔다.',
      '교훈은 하나다. 원장을 먼저 남긴다.',
    ]);
  });

  // 아래 다섯 케이스는 외부 리뷰가 잡아낸 실제 오분류다(모두 prose 로 새어 나왔다).
  // 하나라도 prose 로 분류되면 코드·제목·표가 윤문 대상이 되어 발행본이 깨진다.
  it('4-backtick 펜스 안의 3-backtick 은 블록을 닫지 않는다', () => {
    const { lines, blocks } = scanMarkdownBlocks(
      '````md\n```php\n$a = 1;\n```\n````',
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('keep');
    expect(lines.slice(blocks[0].startLine, blocks[0].endLine + 1)).toContain(
      '$a = 1;',
    );
  });

  it('setext 헤딩은 keep 으로 둔다 (밑줄이 둘째 줄에 온다)', () => {
    const { blocks } = scanMarkdownBlocks('큰 제목\n=======\n\n본문입니다.');

    expect(blocks.map((block) => block.kind)).toEqual(['keep', 'prose']);
  });

  it('4칸 들여쓴 코드블록은 keep 으로 둔다', () => {
    const { blocks } = scanMarkdownBlocks(
      '설명입니다.\n\n    const a = 1;\n    const b = 2;',
    );

    expect(blocks.map((block) => block.kind)).toEqual(['prose', 'keep']);
  });

  it('앞 파이프가 없는 표도 keep 으로 둔다 (구분선이 둘째 줄에 온다)', () => {
    const { blocks } = scanMarkdownBlocks('항목 | 값\n--- | ---\n지연 | 1.2s');

    expect(blocks.map((block) => block.kind)).toEqual(['keep']);
  });

  it('리스트 하위 들여쓴 문단은 keep 으로 둔다 (들여쓰기 손실 방지)', () => {
    const { blocks } = scanMarkdownBlocks('- 항목\n\n  이어지는 설명입니다.');

    expect(blocks.map((block) => block.kind)).toEqual(['keep', 'keep']);
  });

  it('평범한 문단은 그대로 prose 로 남는다 (대조군)', () => {
    const { blocks } = scanMarkdownBlocks(
      '이건 그냥 문단입니다. 윤문돼야 해요.',
    );

    expect(blocks.map((block) => block.kind)).toEqual(['prose']);
  });

  it('닫히지 않은 코드펜스는 문서 끝까지 keep 으로 둔다 (깨진 입력 안전)', () => {
    const { blocks } = scanMarkdownBlocks('본문\n\n```ts\nconst a = 1;');
    expect(blocks.map((block) => block.kind)).toEqual(['prose', 'keep']);
  });
});

describe('maskFencedCodeBlocks / restoreFencedCodeBlocks', () => {
  const markdown = [
    '## 요청',
    '',
    '이렇게 보냅니다.',
    '',
    '```bash',
    'curl -I --header \'If-None-Match: "abc123"\' https://developer.mozilla.org/en-US/',
    '```',
    '',
    '응답은 이렇습니다.',
    '',
    '```http',
    'HTTP/1.1 304 Not Modified',
    'Cache-Control: private',
    '```',
  ].join('\n');

  it('코드블록을 표식으로 가리고 산문은 그대로 둔다', () => {
    const { masked, blocks } = maskFencedCodeBlocks(markdown);

    expect(masked).toMatch(CODE_MASK_PATTERN);
    expect(masked).toContain('이렇게 보냅니다.');
    // 가린 뒤에는 코드가 한 글자도 남지 않아야 한다 — 남으면 모델이 그것을 만진다.
    expect(masked).not.toContain('developer.mozilla.org');
    expect(masked).not.toContain('304 Not Modified');
    expect(blocks).toHaveLength(2);
  });

  it('되돌리면 원문과 한 글자도 다르지 않다', () => {
    const { masked, blocks } = maskFencedCodeBlocks(markdown);

    expect(restoreFencedCodeBlocks(masked, blocks)).toBe(markdown);
  });

  // 편집 단계는 덜어내는 일이라 표식 삭제는 허용이다. 남은 표식만 되돌린다.
  it('표식이 지워진 자리는 그 코드가 빠진 것으로 둔다', () => {
    const { masked, blocks } = maskFencedCodeBlocks(markdown);
    const 편집본 = masked
      .split('\n')
      .filter((line, index, lines) => {
        const first = lines.findIndex((candidate) =>
          CODE_MASK_PATTERN.test(candidate),
        );
        return index !== first;
      })
      .join('\n');

    const restored = restoreFencedCodeBlocks(편집본, blocks);

    expect(restored).not.toContain('developer.mozilla.org');
    expect(restored).toContain('304 Not Modified');
    expect(restored).not.toMatch(CODE_MASK_PATTERN);
  });

  // 리뷰 P1 — 순번 표식이면 모델이 앞 예시를 지우고 뒤 표식을 1번부터 다시 매길 때 복원이
  // 엉뚱한 코드를 넣고, 남은 표식도 없어 두 게이트를 모두 통과한다. 해시 ID 는 재번호화가
  // 불가능하고, 모르는 ID 는 표식으로 남아 검사에 걸린다.
  it('모델이 표식 ID 를 임의로 바꾸면 엉뚱한 코드가 아니라 표식이 남는다', () => {
    const { masked, blocks } = maskFencedCodeBlocks(markdown);
    const ids = [...masked.matchAll(/CODE_BLOCK_([0-9a-f]+)/g)].map(
      (match) => match[1],
    );
    expect(ids).toHaveLength(2);
    // 앞 예시를 지우고 뒤 표식을 앞 ID 로 바꿔 쓰는 시나리오.
    const 변조본 = masked
      .replace(`<!-- CODE_BLOCK_${ids[0]} -->\n\n`, '')
      .replace(ids[1], 'deadbeef');

    const restored = restoreFencedCodeBlocks(변조본, blocks);

    expect(restored).toMatch(CODE_MASK_PATTERN);
    expect(restored).not.toContain('developer.mozilla.org');
    expect(restored).not.toContain('304 Not Modified');
  });

  // 리뷰 P2 / MUST_FIX — 블록마다 치환을 누적하면 앞서 복원한 코드 안의 표식 문자열까지
  // 치환돼 본문이 변조된다. 단일 패스는 복원된 내용을 다시 보지 않는다.
  it('복원된 코드 안의 표식 문자열은 다시 치환하지 않는다', () => {
    const 표식문자열 = maskFencedCodeBlocks(
      ['```txt', 'placeholder', '```'].join('\n'),
    ).masked.trim();
    const 문서 = [
      '```txt',
      // 첫 블록이 두 번째 블록의 표식과 같은 문자열을 코드로 담고 있다.
      표식문자열,
      '```',
      '',
      '사이 문단.',
      '',
      '```txt',
      'placeholder',
      '```',
    ].join('\n');

    const { masked, blocks } = maskFencedCodeBlocks(문서);

    expect(restoreFencedCodeBlocks(masked, blocks)).toBe(문서);
  });

  it('같은 코드가 두 번 나와도 각 자리에 그 코드가 들어간다', () => {
    const 문서 = [
      '```sh',
      'echo hello',
      '```',
      '',
      '사이 문단.',
      '',
      '```sh',
      'echo hello',
      '```',
    ].join('\n');

    const { masked, blocks } = maskFencedCodeBlocks(문서);

    expect(blocks).toHaveLength(2);
    expect(restoreFencedCodeBlocks(masked, blocks)).toBe(문서);
  });

  it('코드블록이 없으면 원문을 그대로 돌려준다', () => {
    const { masked, blocks } = maskFencedCodeBlocks('산문만 있습니다.');

    expect(masked).toBe('산문만 있습니다.');
    expect(blocks).toHaveLength(0);
  });
});

describe('stripStructuralEmDashes', () => {
  // 말투 단계는 산문 문단만 모델에 넘긴다. 그래서 프롬프트의 줄표 금지가 헤딩·목록에 닿지 않고,
  // 규칙을 넣고 발행한 글에서 줄표 9개가 전부 그 두 자리에 있었다(산문 0개).
  it('헤딩 머리말의 줄표를 콜론으로 바꾼다', () => {
    expect(stripStructuralEmDashes('## 채점관 — /goal')).toBe(
      '## 채점관: /goal',
    );
  });

  it('목록 머리말의 줄표를 콜론으로 바꾼다', () => {
    expect(stripStructuralEmDashes('- 채점관 — 조건을 확인해요.')).toBe(
      '- 채점관: 조건을 확인해요.',
    );
  });

  it('번호 목록도 같이 다룬다', () => {
    expect(stripStructuralEmDashes('1. 첫째 — 설명이에요.')).toBe(
      '1. 첫째: 설명이에요.',
    );
  });

  // 산문 속 줄표는 부연을 쉼표로 붙일지 문장을 나눌지가 뜻에 따라 갈린다. 기계가 정할 수 없어
  // 말투 단계와 `emDashCount` 지표에 맡긴다.
  it('산문의 줄표는 손대지 않는다', () => {
    const prose = '본문에는 줄표 — 이렇게 — 그대로 둔다.';
    expect(stripStructuralEmDashes(prose)).toBe(prose);
  });

  // 뒤엣것은 머리말 구분자가 아니라 서술 안의 줄표라, 콜론으로 바꾸면 문장이 어그러진다.
  it('한 줄에 여러 개면 머리말 하나만 바꾼다', () => {
    expect(stripStructuralEmDashes('- 시계 — `/loop` — 시간에 켜요.')).toBe(
      '- 시계: `/loop` — 시간에 켜요.',
    );
  });

  it('코드 펜스 안은 건드리지 않는다', () => {
    const markdown = ['```bash', '# 주석 — 설명', 'echo "a — b"', '```'].join(
      '\n',
    );
    expect(stripStructuralEmDashes(markdown)).toBe(markdown);
  });

  it('줄표가 없으면 원문 그대로다', () => {
    const markdown = '## 제목\n\n본문이에요.\n\n- 항목이에요.';
    expect(stripStructuralEmDashes(markdown)).toBe(markdown);
  });
});

describe('countMarkdownStructure — 단계 경계 계측', () => {
  it('헤딩·인용·링크·코드블록을 종류별로 센다', () => {
    const 본문 = [
      '# 제목',
      '',
      '### 소제목',
      '',
      '> 인용 첫 줄',
      '> 인용 둘째 줄',
      '',
      '[MDN](https://developer.mozilla.org) 과 https://example.com 을 봤다.',
      '',
      '```ts',
      'const a = 1;',
      '```',
    ].join('\n');

    expect(countMarkdownStructure(본문)).toEqual({
      chars: 본문.trim().length,
      headings: 2,
      // 블록이 아니라 **줄 수** 다 — 한 덩어리가 통째로 빠졌는지 안에서 몇 줄만 빠졌는지를
      // 블록 수로는 가를 수 없다.
      quotes: 2,
      links: 2,
      codeBlocks: 1,
    });
  });

  // 코드블록 안의 `#` 주석과 `>` 프롬프트를 헤딩·인용으로 세면, 편집이 산문 헤딩을 지워도
  // 총계가 그대로여서 계측이 손실을 가린다.
  it('코드블록 안의 #·>·URL 은 세지 않는다', () => {
    const 본문 = [
      '## 실행',
      '',
      '```bash',
      '# 주석입니다',
      '> here-doc 프롬프트',
      'curl https://example.com',
      '```',
    ].join('\n');

    expect(countMarkdownStructure(본문)).toMatchObject({
      headings: 1,
      quotes: 0,
      links: 0,
      codeBlocks: 1,
    });
  });

  // 실측된 손실 형태 — 편집이 인용을 전부 지우고 헤딩을 반으로 줄여도 글자 수는 60% 위에
  // 남는다. 문자 게이트가 못 보는 자리를 이 계측이 본다.
  it('글자 수는 60% 위인데 인용·헤딩만 사라진 경우를 잡아낸다', () => {
    const 원문 = [
      '## 가',
      '',
      '> 인용',
      '',
      '가'.repeat(100),
      '',
      '## 나',
    ].join('\n');
    const 편집본 = ['## 가', '', '가'.repeat(100)].join('\n');

    const before = countMarkdownStructure(원문);
    const after = countMarkdownStructure(편집본);

    expect(after.chars).toBeGreaterThan(before.chars * 0.6);
    expect(after.quotes).toBe(0);
    expect(before.quotes).toBe(1);
    expect(after.headings).toBe(1);
    expect(before.headings).toBe(2);
  });
});
