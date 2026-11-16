import { parseParamTuneCliArguments } from './param-tune-cli.parser';

const valid = [
  '--run-id',
  '7',
  '--attempt-token',
  'tok',
  '--strategy',
  'SWING',
  '--axis',
  'EXIT_TAKE_PROFIT_PERCENT',
  '--today',
  '2026-11-16',
];

describe('parseParamTuneCliArguments', () => {
  it('올바른 인자를 파싱한다', () => {
    expect(parseParamTuneCliArguments(valid)).toEqual({
      runId: 7,
      attemptToken: 'tok',
      strategy: 'SWING',
      axis: 'EXIT_TAKE_PROFIT_PERCENT',
      today: '2026-11-16',
      agentRunId: null,
    });
  });

  it('--agent-run-id 를 받는다', () => {
    expect(
      parseParamTuneCliArguments([...valid, '--agent-run-id', '9']).agentRunId,
    ).toBe(9);
  });

  it.each([
    ['--run-id 누락', valid.slice(2)],
    ['잘못된 strategy', valid.map((v) => (v === 'SWING' ? 'X' : v))],
    [
      '잘못된 axis',
      valid.map((v) => (v === 'EXIT_TAKE_PROFIT_PERCENT' ? 'NOPE' : v)),
    ],
    ['잘못된 today', valid.map((v) => (v === '2026-11-16' ? '2026-02-30' : v))],
  ])('%s 이면 사용법과 함께 던진다', (_label, argv) => {
    expect(() => parseParamTuneCliArguments(argv)).toThrow('사용법');
  });
});
