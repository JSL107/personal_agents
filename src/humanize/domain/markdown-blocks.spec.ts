import {
  CODE_MASK_PATTERN,
  maskFencedCodeBlocks,
  restoreFencedCodeBlocks,
  scanMarkdownBlocks,
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

    expect(masked).toContain('<!-- CODE_BLOCK_1 -->');
    expect(masked).toContain('<!-- CODE_BLOCK_2 -->');
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
    const 편집본 = masked.replace('<!-- CODE_BLOCK_1 -->\n\n', '');

    const restored = restoreFencedCodeBlocks(편집본, blocks);

    expect(restored).not.toContain('developer.mozilla.org');
    expect(restored).toContain('304 Not Modified');
    expect(restored).not.toMatch(CODE_MASK_PATTERN);
  });

  it('모델이 표식을 변형하면 되돌리지 못한 표식이 남는다', () => {
    const { masked, blocks } = maskFencedCodeBlocks(markdown);
    const 변형본 = masked.replace('CODE_BLOCK_1', 'CODE_BLOCK_9');

    const restored = restoreFencedCodeBlocks(변형본, blocks);

    // 호출부가 이 상태를 잡아내야 한다 — 그대로 발행되면 독자가 표식을 본다.
    expect(restored).toMatch(CODE_MASK_PATTERN);
  });

  it('코드블록이 없으면 원문을 그대로 돌려준다', () => {
    const { masked, blocks } = maskFencedCodeBlocks('산문만 있습니다.');

    expect(masked).toBe('산문만 있습니다.');
    expect(blocks).toHaveLength(0);
  });
});
