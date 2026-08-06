import { markdownToBlocks } from './markdown-to-blocks';

describe('markdownToBlocks', () => {
  it('지원하는 블록 문법을 Notion block 종류로 변환한다', () => {
    const blocks = markdownToBlocks(
      [
        '## 두 번째 제목',
        '### 세 번째 제목',
        '- 불릿',
        '* 별 불릿',
        '1. 번호',
        '> 인용',
        '---',
        '문단',
        '```typescript',
        'const value = 1;',
        '```',
      ].join('\n'),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'subheading',
      'bullet',
      'bullet',
      'numbered',
      'quote',
      'divider',
      'paragraph',
      'code',
    ]);
    expect(blocks[8]).toMatchObject({
      type: 'code',
      text: 'const value = 1;',
      language: 'typescript',
    });
  });

  it('미지원 code fence 언어는 plain text로 바꾼다', () => {
    const [block] = markdownToBlocks('```unknown-language\nvalue\n```');

    expect(block).toMatchObject({ type: 'code', language: 'plain text' });
  });

  it('굵게와 inline code 기호를 제거하고 annotation을 보존한다', () => {
    const [block] = markdownToBlocks(
      '일반 **굵게** 그리고 `const value = 1` 끝',
    );

    expect(block).toMatchObject({ type: 'paragraph' });
    if (block.type !== 'paragraph') {
      throw new Error('paragraph block expected');
    }
    if (!block.richText) {
      throw new Error('rich text expected');
    }
    expect(block.richText.map((item) => item.text.content).join('')).toBe(
      '일반 굵게 그리고 const value = 1 끝',
    );
    expect(block.richText).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ annotations: { bold: true } }),
        expect.objectContaining({ annotations: { code: true } }),
      ]),
    );
    expect(JSON.stringify(block.richText)).not.toContain('**');
    expect(JSON.stringify(block.richText)).not.toContain('`');
  });

  it('rich_text 조각을 유니코드 code point 기준 2,000자 이하로 나눈다', () => {
    const text = '😀'.repeat(2_001);
    const [block] = markdownToBlocks(text);

    if (block.type !== 'paragraph') {
      throw new Error('paragraph block expected');
    }
    if (!block.richText) {
      throw new Error('rich text expected');
    }
    expect(block.richText).toHaveLength(2);
    expect(block.richText[0].text.content).toBe('😀'.repeat(2_000));
    expect(block.richText[1].text.content).toBe('😀');
    expect(block.richText.map((item) => item.text.content).join('')).toBe(text);
  });

  it('불릿의 들여쓰기 연속 줄을 같은 블록에 이어 붙인다', () => {
    const blocks = markdownToBlocks(
      [
        '- 핵심 단위는 Agent Card다.',
        '  원격 에이전트의 이름, endpoint, capabilities 를 JSON 으로 공개한다.',
      ].join('\n'),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'bullet',
      text: [
        '핵심 단위는 Agent Card다.',
        '원격 에이전트의 이름, endpoint, capabilities 를 JSON 으로 공개한다.',
      ].join('\n'),
    });
  });

  it('빈 줄 이후의 들여쓴 줄은 불릿과 별도 paragraph로 변환한다', () => {
    const blocks = markdownToBlocks(
      ['- 불릿 A', '  설명 A', '', '  들여쓴 별개 문단'].join('\n'),
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: 'bullet',
      text: '불릿 A\n설명 A',
    });
    expect(blocks[0]).not.toMatchObject({
      text: expect.stringContaining('들여쓴 별개 문단'),
    });
    expect(blocks[1]).toMatchObject({
      type: 'paragraph',
      text: '  들여쓴 별개 문단',
    });
  });

  it('번호 목록의 들여쓰기 연속 줄을 같은 블록에 이어 붙인다', () => {
    const blocks = markdownToBlocks(
      ['1. 첫 번째 단계', '  세부 설명'].join('\n'),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'numbered',
      text: '첫 번째 단계\n세부 설명',
    });
  });

  it('들여쓴 divider를 paragraph와 분리한다', () => {
    const blocks = markdownToBlocks('문단\n  ---');

    expect(blocks).toEqual([
      expect.objectContaining({ type: 'paragraph', text: '문단' }),
      { type: 'divider' },
    ]);
    expect(blocks[0]).not.toMatchObject({
      text: expect.stringContaining('---'),
    });
  });

  it('들여쓰지 않은 divider를 divider block으로 변환한다', () => {
    expect(markdownToBlocks('---')).toEqual([{ type: 'divider' }]);
  });

  it('code fence 안의 들여쓴 divider를 code 내용으로 보존한다', () => {
    const [block] = markdownToBlocks(['```text', '  ---', '```'].join('\n'));

    expect(block).toMatchObject({ type: 'code', text: '  ---' });
  });

  it('bullet 뒤의 들여쓴 divider를 bullet continuation으로 합치지 않는다', () => {
    const blocks = markdownToBlocks('- 항목\n  ---');

    expect(blocks).toEqual([
      expect.objectContaining({ type: 'bullet', text: '항목' }),
      { type: 'divider' },
    ]);
  });

  it.each([
    ['----', [{ type: 'divider' }]],
    [
      '--- text',
      [
        expect.objectContaining({
          type: 'paragraph',
          text: '--- text',
        }),
      ],
    ],
  ])(
    'divider 문법 경계 %s을 literal block으로 변환한다',
    (markdown, expected) => {
      expect(markdownToBlocks(markdown)).toEqual(expected);
    },
  );

  it.each([
    '- 하위 불릿',
    '* 하위 불릿',
    '1. 하위 번호',
    '# 제목',
    '> 인용',
    '```',
  ])('들여쓴 새 블록 문법 %s은 직전 블록에 이어 붙이지 않는다', (syntax) => {
    const blocks = markdownToBlocks(`- 첫 블록\n  ${syntax}`);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'bullet', text: '첫 블록' });
  });

  it('들여쓰기 연속 줄의 inline annotation을 보존한다', () => {
    const [block] = markdownToBlocks('- 시작\n  **굵게**와 `코드`');

    if (block.type !== 'bullet' || !block.richText) {
      throw new Error('bullet rich text expected');
    }
    expect(block.richText.map((item) => item.text.content).join('')).toBe(
      '시작\n굵게와 코드',
    );
    expect(block.richText).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ annotations: { bold: true } }),
        expect.objectContaining({ annotations: { code: true } }),
      ]),
    );
  });

  it('code fence 안의 들여쓰기를 코드 내용으로 그대로 보존한다', () => {
    const [block] = markdownToBlocks(
      ['```typescript', '  const value = 1;', '```'].join('\n'),
    );

    expect(block).toMatchObject({
      type: 'code',
      text: '  const value = 1;',
    });
  });

  it('code fence 안의 빈 줄을 코드 내용으로 보존한다', () => {
    const [block] = markdownToBlocks(
      [
        '```typescript',
        'const first = 1;',
        '',
        'const second = 2;',
        '```',
      ].join('\n'),
    );

    expect(block).toMatchObject({
      type: 'code',
      text: 'const first = 1;\n\nconst second = 2;',
    });
  });

  it('첫 줄이 들여쓰기면 paragraph로 처리한다', () => {
    const [block] = markdownToBlocks('  첫 줄은 연속 줄이 아니다');

    expect(block).toMatchObject({
      type: 'paragraph',
      text: '  첫 줄은 연속 줄이 아니다',
    });
  });

  it('연속 줄을 이어 붙여도 rich_text 조각은 유니코드 code point 2,000자 이하다', () => {
    const continuation = '😀'.repeat(2_001);
    const [block] = markdownToBlocks(`- 시작\n  ${continuation}`);

    if (block.type !== 'bullet') {
      throw new Error('bullet block expected');
    }
    if (!block.richText) {
      throw new Error('rich text expected');
    }
    expect(block.richText.map((item) => item.text.content).join('')).toBe(
      `시작\n${continuation}`,
    );
    expect(
      block.richText.every(
        (item) => Array.from(item.text.content).length <= 2_000,
      ),
    ).toBe(true);
  });

  it('100개를 넘는 입력 블록을 누락하지 않는다', () => {
    const markdown = Array.from(
      { length: 101 },
      (_, index) => `- item ${index}`,
    ).join('\n');

    expect(markdownToBlocks(markdown)).toHaveLength(101);
  });

  it('빈 입력은 빈 배열이다', () => {
    expect(markdownToBlocks('  \n\n')).toEqual([]);
  });
});
