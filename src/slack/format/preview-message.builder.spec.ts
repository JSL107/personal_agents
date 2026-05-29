import {
  buildPreviewBlocks,
  chunkMrkdwnText,
  SECTION_MRKDWN_LIMIT,
} from './preview-message.builder';

describe('chunkMrkdwnText — Slack section 3000자 한계 대응', () => {
  it('limit 이하 text 는 단일 chunk 반환', () => {
    const text = 'short text';
    expect(chunkMrkdwnText(text, 100)).toEqual([text]);
  });

  it('limit 초과 + newline 있으면 가장 늦은 newline 기준 분할', () => {
    const text = 'a'.repeat(40) + '\n' + 'b'.repeat(40) + '\n' + 'c'.repeat(40);
    const chunks = chunkMrkdwnText(text, 90);
    expect(chunks).toHaveLength(2);
    // 첫 chunk: 40 a + \n + 40 b = 81자 (limit 90 안의 마지막 \n).
    expect(chunks[0]).toBe('a'.repeat(40) + '\n' + 'b'.repeat(40));
    // 두번째 chunk: 시작 \n 제거된 c×40.
    expect(chunks[1]).toBe('c'.repeat(40));
  });

  it('limit 초과 + newline 미존재면 hard cut', () => {
    const text = 'a'.repeat(250);
    const chunks = chunkMrkdwnText(text, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });

  it('마지막 newline 이 limit/2 보다 앞이면 newline 무시 + hard cut (chunk 효율 보존)', () => {
    // limit 100, newline 이 index 10 — limit/2=50 보다 앞.
    const text = 'a'.repeat(10) + '\n' + 'b'.repeat(200);
    const chunks = chunkMrkdwnText(text, 100);
    // newline 무시되어 첫 chunk 가 100자 hard cut.
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[0]).toBe('a'.repeat(10) + '\n' + 'b'.repeat(89));
  });

  it('연속 newline 도 graceful — 다음 chunk 시작 newline 모두 제거', () => {
    const text = 'a'.repeat(50) + '\n\n\n' + 'b'.repeat(50);
    const chunks = chunkMrkdwnText(text, 60);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].startsWith('b')).toBe(true);
  });

  it('빈 문자열은 단일 빈 chunk', () => {
    expect(chunkMrkdwnText('', 100)).toEqual(['']);
  });

  it('text.length === limit 정확히 같으면 단일 chunk (boundary)', () => {
    const text = 'a'.repeat(100);
    expect(chunkMrkdwnText(text, 100)).toEqual([text]);
  });
});

describe('buildPreviewBlocks', () => {
  it('짧은 text — 1 section + 1 actions block', () => {
    const blocks = buildPreviewBlocks({
      previewText: '동기화 후보 3건 검토 후 ✅ 누르세요.',
      previewId: 'prv-1',
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('section');
    expect((blocks[0] as { text: { text: string } }).text.text).toContain(
      '동기화 후보 3건',
    );
    expect(blocks[1].type).toBe('actions');
  });

  it('limit 초과 text — chunk 수 + 1 (actions) blocks', () => {
    const longText = 'line\n'.repeat(800); // ~4000자, newline 많음 → chunk 2개 이상.
    const blocks = buildPreviewBlocks({
      previewText: longText,
      previewId: 'prv-long',
    });
    const sectionBlocks = blocks.filter((b) => b.type === 'section');
    expect(sectionBlocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[blocks.length - 1].type).toBe('actions');
    // 각 section text 가 limit 안.
    for (const section of sectionBlocks) {
      const text = (section as { text: { text: string } }).text.text;
      expect(text.length).toBeLessThanOrEqual(SECTION_MRKDWN_LIMIT);
    }
  });

  it('actions block 의 buttons / value / action_id 정확', () => {
    const blocks = buildPreviewBlocks({
      previewText: 'ok',
      previewId: 'prv-42',
    });
    const actions = blocks[blocks.length - 1] as {
      type: string;
      block_id: string;
      elements: Array<{ action_id: string; value: string }>;
    };
    expect(actions.block_id).toBe('preview-actions:prv-42');
    expect(actions.elements).toHaveLength(2);
    expect(actions.elements[0].action_id).toBe('preview:apply');
    expect(actions.elements[0].value).toBe('prv-42');
    expect(actions.elements[1].action_id).toBe('preview:cancel');
    expect(actions.elements[1].value).toBe('prv-42');
  });
});
