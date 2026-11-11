import {
  BenchmarkCloseRow,
  holdBuysForMarketRegime,
  judgeMarketRegime,
  MARKET_REGIME_MA_WINDOW,
  MarketRegimeStatus,
  MarketRegimeUnknownReason,
} from './market-regime';

// 2026-07-01 부터 하루씩 count 개. 날짜는 거래일 여부와 무관하게 문자열 순서만 쓴다.
const seriesOf = (closes: number[]): BenchmarkCloseRow[] =>
  closes.map((close, index) => ({
    tradeDate: `2026-07-${String(index + 1).padStart(2, '0')}`,
    close,
  }));
const dataAsOfOf = (count: number): string =>
  `2026-07-${String(count).padStart(2, '0')}`;

describe('judgeMarketRegime', () => {
  // 앞 19개는 100, 마지막이 last → MA20 = (1900 + last) / 20
  const withLast = (last: number): BenchmarkCloseRow[] =>
    seriesOf([...Array(19).fill(100), last]);

  it('기준일 종가가 MA20 위면 OPEN', () => {
    const result = judgeMarketRegime({
      dataAsOf: dataAsOfOf(20),
      closes: withLast(120),
    });

    expect(result).toMatchObject({
      status: MarketRegimeStatus.OPEN,
      unknownReason: null,
      dataAsOf: '2026-07-20',
      close: 120,
      ma20: 101,
      closeCount: 20,
    });
  });

  it('기준일 종가가 MA20 과 같으면 CLOSED', () => {
    // 19개 100 + 마지막 100 → MA20 = 100 = 종가
    const result = judgeMarketRegime({
      dataAsOf: dataAsOfOf(20),
      closes: withLast(100),
    });

    expect(result).toMatchObject({
      status: MarketRegimeStatus.CLOSED,
      unknownReason: null,
    });
  });

  it('기준일 종가가 MA20 아래면 CLOSED', () => {
    const result = judgeMarketRegime({
      dataAsOf: dataAsOfOf(20),
      closes: withLast(80),
    });

    expect(result).toMatchObject({
      status: MarketRegimeStatus.CLOSED,
      close: 80,
      ma20: 99,
    });
  });

  it('기준일 이후 종가와 20개를 넘는 과거 종가는 MA20 에 쓰지 않는다', () => {
    const closes = [
      { tradeDate: '2026-06-01', close: 1_000_000 },
      ...withLast(120),
      { tradeDate: '2026-07-21', close: 1 },
    ];

    const result = judgeMarketRegime({ dataAsOf: dataAsOfOf(20), closes });

    expect(result).toMatchObject({
      status: MarketRegimeStatus.OPEN,
      ma20: 101,
      closeCount: 20,
    });
  });

  it('입력이 뒤섞여 있어도 같은 결과를 낸다', () => {
    const result = judgeMarketRegime({
      dataAsOf: dataAsOfOf(20),
      closes: [...withLast(120)].reverse(),
    });

    expect(result.status).toBe(MarketRegimeStatus.OPEN);
  });

  it('기준일 이하 종가가 20개 미만이면 UNKNOWN', () => {
    const result = judgeMarketRegime({
      dataAsOf: dataAsOfOf(19),
      closes: seriesOf(Array(19).fill(100)),
    });

    expect(result).toMatchObject({
      status: MarketRegimeStatus.UNKNOWN,
      unknownReason: MarketRegimeUnknownReason.INSUFFICIENT_HISTORY,
      closeCount: 19,
      ma20: null,
    });
    expect(MARKET_REGIME_MA_WINDOW).toBe(20);
  });

  it('기준일과 같은 날짜의 종가가 없으면 UNKNOWN (지수 수집이 낡음)', () => {
    const result = judgeMarketRegime({
      dataAsOf: '2026-07-21',
      closes: withLast(80),
    });

    expect(result).toMatchObject({
      status: MarketRegimeStatus.UNKNOWN,
      unknownReason: MarketRegimeUnknownReason.NO_CLOSE_ON_DATA_AS_OF,
    });
  });

  it('종가가 하나도 없으면 UNKNOWN', () => {
    expect(
      judgeMarketRegime({ dataAsOf: dataAsOfOf(20), closes: [] }).status,
    ).toBe(MarketRegimeStatus.UNKNOWN);
  });

  it('dataAsOf 가 null 이면 UNKNOWN', () => {
    expect(
      judgeMarketRegime({ dataAsOf: null, closes: withLast(80) }),
    ).toMatchObject({
      status: MarketRegimeStatus.UNKNOWN,
      unknownReason: MarketRegimeUnknownReason.NO_DATA_AS_OF,
      dataAsOf: null,
    });
  });
});

describe('holdBuysForMarketRegime', () => {
  it('제약을 통과한 매수만 보류 사유로 옮기고 매도와 기존 사유는 그대로 둔다', () => {
    const result = holdBuysForMarketRegime({
      sells: [
        {
          side: 'SELL',
          tickerId: 81,
          code: '005930',
          reason: '추세 훼손',
          quantity: 3,
        },
      ],
      buys: [
        {
          side: 'BUY',
          tickerId: 71,
          code: '000660',
          name: 'SK하이닉스',
          reason: '추세 우위',
          weightPercent: 20,
          quantity: 10,
          close: 100_000,
        },
      ],
      skipped: [{ side: 'BUY', code: '123456', reason: 'NOT_IN_CANDIDATES' }],
    });

    expect(result.buys).toEqual([]);
    expect(result.sells.map((sell) => sell.code)).toEqual(['005930']);
    expect(result.skipped).toEqual([
      { side: 'BUY', code: '123456', reason: 'NOT_IN_CANDIDATES' },
      { side: 'BUY', code: '000660', reason: 'MARKET_REGIME_GATE' },
    ]);
  });
});
