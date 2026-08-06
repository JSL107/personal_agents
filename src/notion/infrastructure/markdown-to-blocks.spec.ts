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
