import { parseScreenerCliArguments } from './screener-cli.parser';

describe('parseScreenerCliArguments', () => {
  it('screen 기본 전략과 limit을 적용한다', () => {
    expect(parseScreenerCliArguments(['screen'])).toEqual({
      subcommand: 'screen',
      options: { strategy: 'LONG_TERM' },
    });
    expect(
      parseScreenerCliArguments([
        'screen',
        '--strategy',
        'SWING',
        '--limit',
        '7',
      ]),
    ).toEqual({
      subcommand: 'screen',
      options: { strategy: 'SWING', limit: 7 },
    });
  });

  it('--record는 값을 받지 않는 플래그이고 뒤 옵션을 삼키지 않는다', () => {
    expect(
      parseScreenerCliArguments([
        'screen',
        '--record',
        '--strategy',
        'SWING',
        '--limit',
        '3',
      ]),
    ).toEqual({
      subcommand: 'screen',
      // CLI 실행에는 추천 실행 id 가 없다 — 그래서 운영 회차를 덮어쓰지 못한다.
      options: { strategy: 'SWING', limit: 3, record: { agentRunId: null } },
    });
    expect(
      parseScreenerCliArguments(['screen', '--limit', '3', '--record']),
    ).toEqual({
      subcommand: 'screen',
      options: {
        strategy: 'LONG_TERM',
        limit: 3,
        record: { agentRunId: null },
      },
    });
  });

  it('지원하지 않는 전략을 사용법 오류로 거부한다', () => {
    expect(() =>
      parseScreenerCliArguments(['screen', '--strategy', 'DAY_TRADE']),
    ).toThrow('사용법');
  });

  it('기존 sync-universe와 collect-prices 인자 계약을 보존한다', () => {
    expect(parseScreenerCliArguments(['sync-universe'])).toEqual({
      subcommand: 'sync-universe',
      options: {},
    });
    expect(
      parseScreenerCliArguments([
        'collect-prices',
        '--days',
        '200',
        '--limit',
        '3',
      ]),
    ).toEqual({
      subcommand: 'collect-prices',
      options: { days: 200, limit: 3 },
    });
  });

  it('collect-benchmark에 days만 전달한다', () => {
    expect(parseScreenerCliArguments(['collect-benchmark'])).toEqual({
      subcommand: 'collect-benchmark',
      options: {},
    });
    expect(
      parseScreenerCliArguments(['collect-benchmark', '--days', '200']),
    ).toEqual({
      subcommand: 'collect-benchmark',
      options: { days: 200 },
    });
  });

  it('collect-benchmark의 days 외 옵션과 양수가 아닌 값을 거부한다', () => {
    expect(() =>
      parseScreenerCliArguments(['collect-benchmark', '--limit', '3']),
    ).toThrow('사용법');
    expect(() =>
      parseScreenerCliArguments(['collect-benchmark', '--days', '0']),
    ).toThrow('--days는 양의 정수여야 합니다.');
  });

  // 재는 지평도 대상도 원장이 정하므로 옵션이 없다. 옵션을 조용히 무시하면 사용자가
  // 지정한 값이 안 먹은 것을 모른 채 결과를 신뢰하게 된다.
  it('score-outcomes는 옵션 없이 받고, 옵션이 붙으면 거부한다', () => {
    expect(parseScreenerCliArguments(['score-outcomes'])).toEqual({
      subcommand: 'score-outcomes',
      options: {},
    });
    expect(() =>
      parseScreenerCliArguments(['score-outcomes', '--horizon', '5']),
    ).toThrow('사용법');
  });
});
