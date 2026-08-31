import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import {
  buildPreviewBlocks,
  buildResolvedPreviewBlocks,
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

describe('buildResolvedPreviewBlocks', () => {
  it('APPLIED 는 버튼(actions) 블록이 없고 ✅ 머리말을 단다', () => {
    const blocks = buildResolvedPreviewBlocks({
      state: 'APPLIED',
      bodyText: '발행 완료',
      previewId: 'p-1',
    });

    const hasActions = blocks.some((b) => b.type === 'actions');
    expect(hasActions).toBe(false);
    const firstText = JSON.stringify(blocks[0]);
    expect(firstText).toContain('✅');
  });

  it('EXPIRED 는 ⌛ 머리말 + 버튼 없음', () => {
    const blocks = buildResolvedPreviewBlocks({
      state: 'EXPIRED',
      bodyText: '만료',
      previewId: 'p-1',
    });

    expect(blocks.some((b) => b.type === 'actions')).toBe(false);
    expect(JSON.stringify(blocks[0])).toContain('⌛');
  });

  it('APPLY_FAILED 만 버튼(actions)을 되살린다', () => {
    const blocks = buildResolvedPreviewBlocks({
      state: 'APPLY_FAILED',
      bodyText: '실패',
      previewId: 'p-9',
    });

    const actions = blocks.find((b) => b.type === 'actions');
    expect(actions).toBeDefined();
    expect(JSON.stringify(actions)).toContain('p-9');
  });

  it('APPLYING 은 ⏳ 머리말 + 버튼 없음', () => {
    const blocks = buildResolvedPreviewBlocks({
      state: 'APPLYING',
      bodyText: '처리 중',
      previewId: 'p-1',
    });

    expect(blocks.some((b) => b.type === 'actions')).toBe(false);
    expect(JSON.stringify(blocks[0])).toContain('⏳');
  });
});

describe('chunkMrkdwnText — 링크 경계 보존', () => {
  it('상한 경계에 걸린 링크를 두 조각으로 가르지 않는다', () => {
    const filler = 'ㄱ'.repeat(2930);
    const chunks = chunkMrkdwnText(
      `${filler}<https://github.com/owner/repo/pull/12345|repo #12345> 꼬리`,
      SECTION_MRKDWN_LIMIT,
    );

    for (const chunk of chunks) {
      expect((chunk.match(/</g) ?? []).length).toBe(
        (chunk.match(/>/g) ?? []).length,
      );
    }
  });
});

// 경력 반영 카드에만 승인 전 "작업 맥락" 입력칸이 묶음(저장소) 수만큼 붙는다.
describe('buildPreviewBlocks — 경력 맥락 입력칸', () => {
  const CAREER_PAYLOAD = {
    prGroups: [['o/company#1', 'o/company#2'], ['o/personal#9']],
    slackUserId: 'U1',
  };

  it('묶음마다 input 블록을 하나씩, 버튼보다 위에 둔다', () => {
    const blocks = buildPreviewBlocks({
      previewText: '경력 반영 후보',
      previewId: 'prv-c1',
      kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
      payload: CAREER_PAYLOAD,
    });

    expect(blocks).toHaveLength(4);
    expect(blocks[0].type).toBe('section');
    expect(blocks[1].type).toBe('input');
    expect(blocks[2].type).toBe('input');
    // 적기 전에 승인을 누르는 순서를 만들지 않으려면 버튼보다 위여야 한다.
    expect(blocks[3].type).toBe('actions');

    const first = blocks[1] as {
      block_id: string;
      dispatch_action: boolean;
      label: { text: string };
      element: { action_id: string; initial_value?: string };
    };
    expect(first.block_id).toBe('career-context:prv-c1:0');
    // 메시지 안의 input 은 제출 버튼이 없다 — 이 값이 없으면 적어도 전달되지 않는다.
    expect(first.dispatch_action).toBe(true);
    expect(first.element.action_id).toBe('career-context:set');
    expect(first.element.initial_value).toBeUndefined();
    // 어느 저장소 칸인지 라벨로 구분돼야 한다 — 아니면 회사 수치를 개인 칸에 적게 된다.
    expect(first.label.text).toContain('o/company');
    expect((blocks[2] as { block_id: string }).block_id).toBe(
      'career-context:prv-c1:1',
    );
    expect((blocks[2] as { label: { text: string } }).label.text).toContain(
      'o/personal',
    );
  });

  it('이미 적어둔 맥락은 그 묶음 칸에만 initial_value 로 되살린다', () => {
    const blocks = buildPreviewBlocks({
      previewText: '경력 반영 후보',
      previewId: 'prv-c2',
      kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
      payload: {
        ...CAREER_PAYLOAD,
        impactContexts: [null, '주간 배치 실패 12건 → 0건'],
      },
    });
    expect(
      (blocks[1] as { element: { initial_value?: string } }).element
        .initial_value,
    ).toBeUndefined();
    expect(
      (blocks[2] as { element: { initial_value?: string } }).element
        .initial_value,
    ).toBe('주간 배치 실패 12건 → 0건');
  });

  it('구형 prRefs 카드도 한 묶음으로 입력칸을 받는다', () => {
    const blocks = buildPreviewBlocks({
      previewText: '경력 반영 후보',
      previewId: 'prv-c4',
      kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
      payload: { prRefs: ['o/legacy#3'], slackUserId: 'U1' },
    });
    expect(blocks.filter((block) => block.type === 'input')).toHaveLength(1);
    expect((blocks[1] as { block_id: string }).block_id).toBe(
      'career-context:prv-c4:0',
    );
  });

  it('다른 kind 와 kind 미지정은 입력칸 없이 종전과 같다', () => {
    const base = buildPreviewBlocks({
      previewText: '블로그 발행 후보',
      previewId: 'prv-b1',
    });
    const blog = buildPreviewBlocks({
      previewText: '블로그 발행 후보',
      previewId: 'prv-b1',
      kind: PREVIEW_KIND.EVENING_BLOG_PUBLISH,
      payload: CAREER_PAYLOAD,
    });
    expect(base).toEqual(blog);
    expect(base.some((block) => block.type === 'input')).toBe(false);
  });

  it('묶음을 못 읽는 payload 면 입력칸 없이 승인 버튼은 남긴다', () => {
    const blocks = buildPreviewBlocks({
      previewText: '경력 반영 후보',
      previewId: 'prv-c5',
      kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
      payload: null,
    });
    expect(blocks.some((block) => block.type === 'input')).toBe(false);
    expect(blocks[blocks.length - 1].type).toBe('actions');
  });

  it('해소된 카드에는 입력칸을 남기지 않는다 (반영될 곳이 없다)', () => {
    const blocks = buildResolvedPreviewBlocks({
      state: 'APPLY_FAILED',
      bodyText: '실패',
      previewId: 'prv-c3',
    });
    expect(blocks.some((block) => block.type === 'input')).toBe(false);
    expect(blocks[blocks.length - 1].type).toBe('actions');
  });
});
