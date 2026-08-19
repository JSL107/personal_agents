import { scanMarkdownBlocks } from './markdown-blocks';

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

  it('닫히지 않은 코드펜스는 문서 끝까지 keep 으로 둔다 (깨진 입력 안전)', () => {
    const { blocks } = scanMarkdownBlocks('본문\n\n```ts\nconst a = 1;');
    expect(blocks.map((block) => block.kind)).toEqual(['prose', 'keep']);
  });
});
