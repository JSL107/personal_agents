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
