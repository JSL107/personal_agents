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
});
