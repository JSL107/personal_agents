import {
  BenchmarkCloseRow,
  judgeMarketRegime,
  MARKET_REGIME_MA_WINDOW,
} from './market-regime';

// 2026-07-01 부터 하루씩 count 개. 날짜는 거래일 여부와 무관하게 문자열 순서만 쓴다.
const seriesOf = (closes: number[]): BenchmarkCloseRow[] =>
  closes.map((close, index) => ({
    tradeDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
    close,
  }));
const asOfOf = (count: number): string =>
  `2026-07-${String(count).padStart(2, '0')}`;

describe('judgeMarketRegime', () => {
  // 앞 19개는 100, 마지막이 last → MA20 = (1900 + last) / 20
  const withLast = (last: number): BenchmarkCloseRow[] =>
    seriesOf([...Array(19).fill(100), last]);

  it('기준일 종가가 MA20 위면 OPEN', () => {
    const result = judgeMarketRegime({
      asOf: asOfOf(20),
      closes: withLast(120),
    });

    expect(result).toMatchObject({
      status: 'OPEN',
      reason: 'ABOVE_MA',
      asOf: '2026-07-20',
      close: 120,
      ma20: 101,
      closeCount: 20,
    });
  });

  it('기준일 종가가 MA20 과 같으면 CLOSED', () => {
    // 19개 100 + 마지막 100 → MA20 = 100 = 종가
    const result = judgeMarketRegime({
      asOf: asOfOf(20),
      closes: withLast(100),
    });

    expect(result).toMatchObject({
      status: 'CLOSED',
      reason: 'AT_OR_BELOW_MA',
    });
  });

  it('기준일 종가가 MA20 아래면 CLOSED', () => {
    const result = judgeMarketRegime({
      asOf: asOfOf(20),
      closes: withLast(80),
    });

    expect(result).toMatchObject({ status: 'CLOSED', close: 80, ma20: 99 });
  });

  it('기준일 이후 종가와 20개를 넘는 과거 종가는 MA20 에 쓰지 않는다', () => {
    const closes = [
      { tradeDate: '2026-06-01', close: 1_000_000 },
      ...withLast(120),
      { tradeDate: '2026-07-21', close: 1 },
    ];

    const result = judgeMarketRegime({ asOf: asOfOf(20), closes });

    expect(result).toMatchObject({ status: 'OPEN', ma20: 101, closeCount: 20 });
  });

  it('입력이 뒤섞여 있어도 같은 결과를 낸다', () => {
    const result = judgeMarketRegime({
      asOf: asOfOf(20),
      closes: [...withLast(120)].reverse(),
    });

    expect(result.status).toBe('OPEN');
  });

  it('기준일 이하 종가가 20개 미만이면 UNKNOWN', () => {
    const result = judgeMarketRegime({
      asOf: asOfOf(19),
      closes: seriesOf(Array(19).fill(100)),
    });

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      reason: 'INSUFFICIENT_HISTORY',
      closeCount: 19,
      ma20: null,
    });
    expect(MARKET_REGIME_MA_WINDOW).toBe(20);
  });

  it('기준일과 같은 날짜의 종가가 없으면 UNKNOWN (지수 수집이 낡음)', () => {
    const result = judgeMarketRegime({
      asOf: '2026-07-21',
      closes: withLast(80),
    });

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      reason: 'NO_CLOSE_ON_AS_OF',
    });
  });

  it('종가가 하나도 없으면 UNKNOWN', () => {
    expect(judgeMarketRegime({ asOf: asOfOf(20), closes: [] }).status).toBe(
      'UNKNOWN',
    );
  });

  it('asOf 가 null 이면 UNKNOWN', () => {
    expect(
      judgeMarketRegime({ asOf: null, closes: withLast(80) }),
    ).toMatchObject({ status: 'UNKNOWN', reason: 'NO_AS_OF', asOf: null });
  });
});
