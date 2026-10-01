import {
  buildRunVerdictBlocks,
  parseRunVerdictValue,
  RUN_VERDICT_ACTION_PATTERN,
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
      '*회고 전체* — 판정됨: 👎 헛다리 <@U1> · 👍 쓸모 있음 <@U2> (바꾸려면 다시 누르기)',
    );
    expect(texts).toContain('*문제 칸* — 판정 전');
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
});
