import { blocksToMarkdown } from './blocks-to-markdown';
import { markdownToBlocks } from './markdown-to-blocks';

describe('blocksToMarkdown', () => {
  it('heading 세 층과 paragraph 을 원본 마크다운 구조로 복원한다', () => {
    const markdown = blocksToMarkdown([
      { type: 'heading_2', text: '제목' },
      { type: 'heading_3', text: '소제목' },
      { type: 'paragraph', text: '본문' },
    ]);

    expect(markdown).toBe(['## 제목', '### 소제목', '본문'].join('\n\n'));
  });

  it('paragraph code fence 사이에는 빈 줄을 넣지 않는다', () => {
    const markdown = blocksToMarkdown([
      { type: 'paragraph', text: '```typescript' },
      { type: 'paragraph', text: 'const first = 1;' },
      { type: 'paragraph', text: 'const second = 2;' },
      { type: 'paragraph', text: 'return first + second;' },
      { type: 'paragraph', text: '```' },
    ]);

    expect(markdown).toBe(
      [
        '```typescript',
        'const first = 1;',
        'const second = 2;',
        'return first + second;',
        '```',
      ].join('\n'),
    );
  });

  it('paragraph code fence 내부의 들여쓰기를 보존한다', () => {
    const markdown = blocksToMarkdown([
      { type: 'paragraph', text: '```python' },
      { type: 'paragraph', text: '  if enabled:' },
      { type: 'paragraph', text: '    return value' },
      { type: 'paragraph', text: '```' },
      { type: 'paragraph', text: '  일반 문단  ' },
    ]);

    expect(markdown).toBe(
      [
        '```python',
        '  if enabled:',
        '    return value',
        '```',
        '',
        '일반 문단',
      ].join('\n'),
    );
  });

  it('code block의 들여쓰기와 의도된 빈 줄을 보존한다', () => {
    const markdown = blocksToMarkdown([
      {
        type: 'code',
        language: 'typescript',
        text: '  const value = 1;\n\n  return value;\n',
      },
    ]);

    expect(markdown).toBe(
      [
        '```typescript',
        '  const value = 1;',
        '',
        '  return value;',
        '',
        '```',
      ].join('\n'),
    );
  });

  it('연속 paragraph 목록 항목을 loose list로 만들지 않는다', () => {
    const markdown = blocksToMarkdown([
      { type: 'paragraph', text: '- 첫 항목' },
      { type: 'paragraph', text: '- 두 번째 항목' },
      { type: 'paragraph', text: '다음 문단' },
    ]);

    expect(markdown).toBe(
      ['- 첫 항목', '- 두 번째 항목', '', '다음 문단'].join('\n'),
    );
  });

  it('변환한 목록과 코드 블록을 markdownToBlocks로 다시 읽어도 안정적이다', () => {
    const markdown = blocksToMarkdown([
      { type: 'bulleted_list_item', text: '항목' },
      { type: 'bulleted_list_item', text: '다음 항목' },
      { type: 'code', text: 'const value = 1;', language: 'typescript' },
    ]);

    expect(markdownToBlocks(markdown)).toEqual([
      expect.objectContaining({ type: 'bullet', text: '항목' }),
      expect.objectContaining({ type: 'bullet', text: '다음 항목' }),
      expect.objectContaining({
        type: 'code',
        text: 'const value = 1;',
        language: 'typescript',
      }),
    ]);
  });

  // 저녁 블로그 applier 가 마크다운을 적재할 때 `# ` 를 heading_2, `## ` 를 heading_3 으로 넣는다
  // (evening-blog-publish.applier.ts). 역변환은 그 대칭을 지켜야 원본 제목 계층이 복원된다.
  // 층을 뭉치면 적재 전에 미리 내리는 보정이 필요해지고, 그 보정이 `##`·`###` 를 한 층으로
  // 만들어 계층을 쓴 글이 발행본에서 평탄화된다(`study-deepdive.parser.ts`).
  it('heading_2 는 ## 로, heading_3 는 ### 로 층을 지켜 되돌린다', () => {
    const markdown = blocksToMarkdown([
      { type: 'heading_2', text: '제목' },
      { type: 'heading_3', text: '소제목' },
      { type: 'paragraph', text: '본문' },
    ]);

    expect(markdown).toBe(['## 제목', '', '### 소제목', '', '본문'].join('\n'));
  });
});
