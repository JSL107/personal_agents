import { parseBacktestCliArguments } from './backtest-cli.parser';

const required = [
  '--strategy',
  'LONG_TERM',
  '--from',
  '2026-01-02',
  '--to',
  '2026-08-14',
];

describe('parseBacktestCliArguments', () => {
  it('필수 인자를 읽고 나머지는 기본값을 채운다', () => {
    const parsed = parseBacktestCliArguments(required);

    expect(parsed).toEqual({
      strategy: 'LONG_TERM',
      from: '2026-01-02',
      to: '2026-08-14',
      seedAmount: '10000000',
      minimumTurnover60: 500000000,
      maximumPositions: 3,
      weightPercent: 20,
      holdingTradeDays: 60,
    });
  });

  it('SWING 의 보유일수 기본값은 5다', () => {
    const parsed = parseBacktestCliArguments([
      '--strategy',
      'SWING',
      '--from',
      '2026-01-02',
      '--to',
      '2026-08-14',
    ]);

    expect(parsed.holdingTradeDays).toBe(5);
  });

  it('주어진 옵션은 기본값을 덮는다', () => {
    const parsed = parseBacktestCliArguments([
      ...required,
      '--seed',
      '5000000',
      '--turnover-min',
      '1e9',
      '--max-positions',
      '5',
      '--weight',
      '15',
      '--hold',
      '30',
    ]);

    expect(parsed.seedAmount).toBe('5000000');
    expect(parsed.minimumTurnover60).toBe(1e9);
    expect(parsed.maximumPositions).toBe(5);
    expect(parsed.weightPercent).toBe(15);
    expect(parsed.holdingTradeDays).toBe(30);
  });

  it('전략이 없거나 잘못되면 사용법과 함께 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments(['--from', '2026-01-02', '--to', '2026-08-14']),
    ).toThrow('--strategy');
    expect(() =>
      parseBacktestCliArguments(['--strategy', 'WRONG', ...required.slice(2)]),
    ).toThrow('--strategy');
  });

  it('날짜 형식이 틀리면 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments([
        '--strategy',
        'SWING',
        '--from',
        '20260102',
        '--to',
        '2026-08-14',
      ]),
    ).toThrow('YYYY-MM-DD');
  });

  it('필수 날짜가 빠지면 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments(['--strategy', 'SWING', '--to', '2026-08-14']),
    ).toThrow('--from');
  });

  // 값 없이 플래그만 온 경우를 잡지 않으면 다음 플래그가 값으로 먹혀
  // 조용히 엉뚱한 설정으로 백테스트가 돌아간다.
  it('옵션에 값이 없으면 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments([...required, '--weight', '--hold', '30']),
    ).toThrow('--weight');
  });

  it('수치 옵션이 0 이하이거나 숫자가 아니면 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments([...required, '--max-positions', '0']),
    ).toThrow('--max-positions');
    expect(() =>
      parseBacktestCliArguments([...required, '--weight', 'abc']),
    ).toThrow('--weight');
  });

  it('시드가 양의 정수가 아니면 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments([...required, '--seed', '1000.5']),
    ).toThrow('--seed');
  });
});
