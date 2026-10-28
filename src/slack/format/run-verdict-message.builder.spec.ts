import {
  buildRunVerdictBlocks,
  buildRunVerdictDigestPages,
  buildRunVerdictFallbackText,
  formatRunVerdictQuote,
  parseRunVerdictValue,
  readRunVerdictQuote,
  readRunVerdictStatusTargets,
  refreshRunVerdictStatuses,
  RUN_VERDICT_ACTION_PATTERN,
  RUN_VERDICT_QUOTE_BLOCK_ID,
} from './run-verdict-message.builder';

type Block = {
  type: string;
  text?: { text: string };
  elements?: { action_id: string; value: string; style?: string }[];
};

const buttonsOf = (blocks: Block[]) =>
  blocks.flatMap((block) => block.elements ?? []);

describe('run-verdict-message.builder', () => {
  it('축마다 버튼 줄을 만들고, 버튼 값은 다시 읽으면 같은 판정이 된다', () => {
    const blocks = buildRunVerdictBlocks({
      agentRunId: 6300,
      facets: ['retro_problem', 'overall'],
      verdicts: {},
    }) as Block[];

    const buttons = buttonsOf(blocks);
    expect(buttons.map((button) => button.action_id)).toEqual([
      'run_verdict:retro_problem:REAL',
      'run_verdict:retro_problem:FABRICATED',
      'run_verdict:overall:GOOD',
      'run_verdict:overall:BAD',
    ]);
    // 핸들러가 이 접두사 하나로 네 버튼을 모두 받는다.
    expect(
      buttons.every((button) =>
        RUN_VERDICT_ACTION_PATTERN.test(button.action_id),
      ),
    ).toBe(true);
    expect(parseRunVerdictValue(buttons[1].value)).toEqual({
      agentRunId: 6300,
      facet: 'retro_problem',
      verdict: 'FABRICATED',
      facets: ['retro_problem', 'overall'],
    });
  });

  it('PO 대행 축은 세 갈래 버튼을 내고, 머리·대체 문구가 PO 대행 몫이다', () => {
    const blocks = buildRunVerdictBlocks({
      agentRunId: 9,
      facets: ['po_first_action'],
      verdicts: {},
    }) as Block[];

    expect(buttonsOf(blocks).map((button) => button.action_id)).toEqual([
      'run_verdict:po_first_action:GOOD',
      'run_verdict:po_first_action:KNOWN',
      'run_verdict:po_first_action:BAD',
    ]);
    expect(blocks[0].text?.text).toContain('PO 대행 판정');
    expect(buildRunVerdictFallbackText(['po_first_action'])).toContain(
      'PO 대행 판정',
    );
    // "이미 알던 것" 은 PO 대행 축에서만 허용된다 — 다른 축 값으로 섞여 들어오지 않는다.
    expect(
      parseRunVerdictValue(
        JSON.stringify({
          agentRunId: 9,
          facet: 'pm_plan',
          verdict: 'KNOWN',
          facets: ['pm_plan'],
        }),
      ),
    ).toBeNull();
  });

  it('인용 이름이 없으면 인용 줄만 싣는다', () => {
    expect(formatRunVerdictQuote('문장')).toBe('> 문장');
  });

  it('문제 칸 축을 내지 않은 날은 그 버튼이 없다', () => {
    const blocks = buildRunVerdictBlocks({
      agentRunId: 1,
      facets: ['overall'],
      verdicts: {},
    }) as Block[];

    expect(
      buttonsOf(blocks).some((button) =>
        button.action_id.includes('retro_problem'),
      ),
    ).toBe(false);
  });

  it('판정한 축은 누른 사람마다 「판정됨」 으로 적는다 — 먼저 누른 사람 판정이 사라지지 않는다', () => {
    const blocks = buildRunVerdictBlocks({
      agentRunId: 1,
      facets: ['retro_problem', 'overall'],
      verdicts: {
        overall: [
          { slackUserId: 'U1', verdict: 'BAD' },
          { slackUserId: 'U2', verdict: 'GOOD' },
        ],
      },
    }) as Block[];

    const texts = blocks.map((block) => block.text?.text ?? '');
    expect(texts).toContain(
      '*이 회고, 하루를 돌아보는 데 쓸모 있었나요?*\n✅ 판정됨: 👎 헛다리 <@U1> · 👍 쓸모 있음 <@U2> _(바꾸려면 다시 누르기)_',
    );
    // 판정 전 축은 물음만 — 버튼 바로 위에서 무엇을 고르는지 읽혀야 한다.
    expect(texts).toContain('*이 아쉬운 점, 실제로 있었던 일인가요?*');
  });

  describe('주간 판정 카드', () => {
    const entry = (agentRunId: number) => ({
      agentRunId,
      facets: ['retro_problem' as const, 'overall' as const],
      dateLabel: '10/27(화)',
      quote: '상벌점 기록 전환 PR(#4436) 담당자 답변 확인 근거가 없다.',
    });

    it('실행마다 날짜·인용 블록과 축별 물음 + 버튼을 싣는다', () => {
      const pages = buildRunVerdictDigestPages({
        heading: '🌙 저녁 회고 판정',
        entries: [entry(11), entry(12)],
      });
      expect(pages).toHaveLength(1);
      const blocks = pages[0] as (Block & { block_id?: string })[];

      expect(blocks[0].text?.text).toContain('지난주 판정 안 된 2건');
      expect(blocks[1].text?.text).toBe(
        '*10/27(화)*\n*회고가 꼽은 아쉬운 점*\n> 상벌점 기록 전환 PR(#4436) 담당자 답변 확인 근거가 없다.',
      );
      expect(readRunVerdictStatusTargets(blocks)).toEqual([
        { agentRunId: 11, facet: 'retro_problem' },
        { agentRunId: 11, facet: 'overall' },
        { agentRunId: 12, facet: 'retro_problem' },
        { agentRunId: 12, facet: 'overall' },
      ]);
      // 버튼 값은 그 실행 몫 — 한 카드에 여러 실행이 있어도 판정이 섞이지 않는다.
      const values = buttonsOf(blocks).map(
        (button) => parseRunVerdictValue(button.value)?.agentRunId,
      );
      expect(new Set(values)).toEqual(new Set([11, 12]));
    });

    it('슬랙 블록 상한(50)을 넘으면 버리지 않고 다음 통으로 넘긴다', () => {
      const entries = Array.from({ length: 12 }, (_, index) =>
        entry(index + 1),
      );
      const pages = buildRunVerdictDigestPages({
        heading: '🌙 저녁 회고 판정',
        entries,
      });

      expect(pages).toHaveLength(2);
      expect(pages.every((page) => page.length <= 50)).toBe(true);
      expect(
        pages.flatMap((page) =>
          readRunVerdictStatusTargets(page)
            .filter((target) => target.facet === 'overall')
            .map((target) => target.agentRunId),
        ),
      ).toEqual(entries.map((item) => item.agentRunId));
      expect((pages[1][0] as Block).text?.text).toContain('12건');
      expect((pages[1][0] as Block).text?.text).toContain('(2/2)');
    });
  });

  describe('refreshRunVerdictStatuses — 누른 뒤 상태 줄만 다시 쓴다', () => {
    it('실행별 원장 값으로 상태 줄을 바꾸고 나머지 블록은 그대로 둔다', () => {
      const [blocks] = buildRunVerdictDigestPages({
        heading: '🗓️ 오늘 아침 계획 판정',
        entries: [
          {
            agentRunId: 1,
            facets: ['pm_plan'],
            dateLabel: '10/27(화)',
            quote: 'A',
          },
          {
            agentRunId: 2,
            facets: ['pm_plan'],
            dateLabel: '10/28(수)',
            quote: 'B',
          },
        ],
      });

      const refreshed = refreshRunVerdictStatuses(
        blocks,
        new Map([[2, { pm_plan: [{ slackUserId: 'U1', verdict: 'BAD' }] }]]),
      ) as Block[];

      const texts = refreshed.map((block) => block.text?.text ?? '');
      expect(texts).toContain('*아침 계획, 실제 하루에 쓸모 있었나요?*');
      expect(texts).toContain(
        '*아침 계획, 실제 하루에 쓸모 있었나요?*\n✅ 판정됨: 👎 헛다리 <@U1> _(바꾸려면 다시 누르기)_',
      );
      expect(refreshed[0]).toBe(blocks[0]);
      expect(refreshed[1]).toBe(blocks[1]);
    });

    it('상태 줄 표시가 없는 옛 댓글은 대상이 비어 있다', () => {
      expect(
        readRunVerdictStatusTargets([
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*문제 칸* — 판정 전' },
          },
        ]),
      ).toEqual([]);
    });
  });

  describe('parseRunVerdictValue — 허용 목록 밖 값은 저장하지 않는다', () => {
    const valid = {
      agentRunId: 1,
      facet: 'overall',
      verdict: 'GOOD',
      facets: ['overall'],
    };

    it.each([
      ['JSON 이 아님', 'not-json'],
      ['빈 값', ''],
      ['모르는 축', JSON.stringify({ ...valid, facet: 'po_first_action' })],
      [
        '축에 없는 판정 값',
        JSON.stringify({ ...valid, verdict: 'FABRICATED' }),
      ],
      ['프로토타입 키', JSON.stringify({ ...valid, verdict: 'toString' })],
      ['음수 실행 id', JSON.stringify({ ...valid, agentRunId: -1 })],
      ['문자열 실행 id', JSON.stringify({ ...valid, agentRunId: '1' })],
      [
        '낸 축 목록에 없는 축',
        JSON.stringify({ ...valid, facets: ['retro_problem'] }),
      ],
      [
        '낸 축 목록에 모르는 값',
        JSON.stringify({ ...valid, facets: ['overall', 'x'] }),
      ],
    ])('%s → null', (_label, raw) => {
      expect(parseRunVerdictValue(raw)).toBeNull();
    });

    it('null 입력 → null', () => {
      expect(parseRunVerdictValue(null)).toBeNull();
    });
  });

  describe('판정 대상 인용', () => {
    it('인용을 주면 머리 바로 아래에 인용 블록을 싣는다', () => {
      const blocks = buildRunVerdictBlocks({
        agentRunId: 1,
        facets: ['retro_problem', 'overall'],
        verdicts: {},
        quoteMrkdwn: formatRunVerdictQuote('확인 없이 결론을 썼다', '문제 칸'),
      }) as (Block & { block_id?: string })[];

      expect(blocks[1]).toMatchObject({
        block_id: RUN_VERDICT_QUOTE_BLOCK_ID,
        text: { text: '*문제 칸*\n> 확인 없이 결론을 썼다' },
      });
    });

    it('인용이 없으면 인용 블록을 내지 않는다', () => {
      const blocks = buildRunVerdictBlocks({
        agentRunId: 1,
        facets: ['overall'],
        verdicts: {},
        quoteMrkdwn: formatRunVerdictQuote('   '),
      }) as (Block & { block_id?: string })[];

      expect(
        blocks.some((block) => block.block_id === RUN_VERDICT_QUOTE_BLOCK_ID),
      ).toBe(false);
    });

    it('길면 자르고, 줄바꿈은 한 줄로 펴고, 제어 문자를 이스케이프한다', () => {
      const quote = formatRunVerdictQuote(
        `a<b>&\n${'가'.repeat(300)}`,
        '문제 칸',
      );

      expect(quote).toContain('a&lt;b&gt;&amp; 가');
      expect(quote?.endsWith('…')).toBe(true);
      expect(quote?.split('\n')).toHaveLength(2);
      expect(quote!.length).toBeLessThan(260);
    });

    // 누른 뒤 다시 그릴 때 서버엔 문장이 없다 — 원래 댓글에서 되읽어 그대로 실어야 인용이 사라지지 않는다.
    it('원래 댓글에서 되읽은 인용은 다시 그려도 한 글자도 바뀌지 않는다', () => {
      const first = buildRunVerdictBlocks({
        agentRunId: 1,
        facets: ['overall'],
        verdicts: {},
        quoteMrkdwn: formatRunVerdictQuote('A & B', '문제 칸'),
      });
      const reread = readRunVerdictQuote({ message: { blocks: first } });
      const redrawn = buildRunVerdictBlocks({
        agentRunId: 1,
        facets: ['overall'],
        verdicts: {},
        quoteMrkdwn: reread,
      });

      expect(redrawn[1]).toEqual(first[1]);
      expect(reread).toBe('*문제 칸*\n> A &amp; B');
    });

    it('인용 블록이 없는 댓글을 되읽으면 undefined', () => {
      expect(readRunVerdictQuote({ message: { blocks: [] } })).toBeUndefined();
      expect(readRunVerdictQuote({})).toBeUndefined();
      expect(readRunVerdictQuote(null)).toBeUndefined();
    });
  });
});
