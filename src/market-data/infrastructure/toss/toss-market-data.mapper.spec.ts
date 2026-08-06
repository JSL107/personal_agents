import { mapTossCandlesResponse } from './toss-market-data.mapper';

const DOMESTIC_CANDLES_RESPONSE = {
  result: {
    candles: [
      {
        timestamp: '2026-08-06T00:00:00.000+09:00',
        openPrice: '12290',
        highPrice: '12370',
        lowPrice: '12230',
        closePrice: '12255',
        volume: '70940',
        currency: 'KRW',
      },
      {
        timestamp: '2026-08-05T00:00:00.000+09:00',
        openPrice: '12150',
        highPrice: '12300',
        lowPrice: '12120',
        closePrice: '12290',
        volume: '80000',
        currency: 'KRW',
      },
      {
        timestamp: '2026-08-04T00:00:00.000+09:00',
        openPrice: '12000',
        highPrice: '12200',
        lowPrice: '11950',
        closePrice: '12150',
        volume: '65000',
        currency: 'KRW',
      },
    ],
    nextBefore: '2026-08-03T00:00:00.000+09:00',
  },
};

const SUMMER_US_CANDLE_RESPONSE = {
  result: {
    candles: [
      {
        timestamp: '2026-08-06T13:00:00.000+09:00',
        openPrice: '25.1',
        highPrice: '25.5',
        lowPrice: '24.9',
        closePrice: '25.2',
        volume: '1234567',
        currency: 'USD',
      },
    ],
    nextBefore: '2026-08-05T13:00:00.000+09:00',
  },
};

const WINTER_US_CANDLE_RESPONSE = {
  result: {
    candles: [
      {
        timestamp: '2026-01-06T14:00:00.000+09:00',
        openPrice: '25.1',
        highPrice: '25.5',
        lowPrice: '24.9',
        closePrice: '25.2',
        volume: '1234567',
        currency: 'USD',
      },
    ],
    nextBefore: '2026-01-05T14:00:00.000+09:00',
  },
};

describe('mapTossCandlesResponse', () => {
  it('최신순 국내 일봉을 거래일 오름차순으로 변환한다', () => {
    const result = mapTossCandlesResponse(DOMESTIC_CANDLES_RESPONSE);

    expect(result).toHaveLength(3);
    expect(result?.map((bar) => bar.tradeDate.toISOString())).toEqual([
      '2026-08-04T00:00:00.000Z',
      '2026-08-05T00:00:00.000Z',
      '2026-08-06T00:00:00.000Z',
    ]);
    expect(result?.[2]).toMatchObject({ currency: 'KRW', volume: 70940n });
  });

  it('여름 미국 일봉은 KST 시각이 아닌 ET 거래일을 보존한다', () => {
    const result = mapTossCandlesResponse(SUMMER_US_CANDLE_RESPONSE);

    expect(result?.[0].tradeDate.toISOString()).toBe(
      '2026-08-06T00:00:00.000Z',
    );
  });

  it('겨울 미국 일봉도 ET 거래일이 밀리지 않는다', () => {
    const result = mapTossCandlesResponse(WINTER_US_CANDLE_RESPONSE);

    expect(result?.[0].tradeDate.toISOString()).toBe(
      '2026-01-06T00:00:00.000Z',
    );
  });

  it.each([
    { result: { items: [] } },
    { result: { candles: {} } },
    { result: [] },
  ])('result.candles 배열이 아니면 null 을 반환한다', (raw) => {
    expect(mapTossCandlesResponse(raw)).toBeNull();
  });

  it.each([
    { ...DOMESTIC_CANDLES_RESPONSE.result.candles[0], timestamp: undefined },
    { ...DOMESTIC_CANDLES_RESPONSE.result.candles[0], closePrice: undefined },
    { ...DOMESTIC_CANDLES_RESPONSE.result.candles[0], volume: undefined },
    { ...DOMESTIC_CANDLES_RESPONSE.result.candles[0], currency: undefined },
    {
      ...DOMESTIC_CANDLES_RESPONSE.result.candles[0],
      closePrice: 'not-a-number',
    },
  ])(
    '필수 필드 누락 또는 유한하지 않은 종가가 있으면 전체 null 을 반환한다',
    (candle) => {
      const result = mapTossCandlesResponse({
        result: {
          candles: [candle],
          nextBefore: '2026-08-03T00:00:00.000+09:00',
        },
      });

      expect(result).toBeNull();
    },
  );

  it('소수점 거래량이 있으면 전체 null 을 반환한다', () => {
    const result = mapTossCandlesResponse({
      result: {
        candles: [
          { ...DOMESTIC_CANDLES_RESPONSE.result.candles[0], volume: '70940.5' },
        ],
        nextBefore: '2026-08-03T00:00:00.000+09:00',
      },
    });

    expect(result).toBeNull();
  });

  it('종가를 close 와 adjClose 에 같은 Decimal 값으로 넣는다', () => {
    const result = mapTossCandlesResponse(DOMESTIC_CANDLES_RESPONSE);

    expect(result?.[2].close.toString()).toBe('12255');
    expect(result?.[2].adjClose.toString()).toBe('12255');
  });
});
