import { mapTossMarketIndicatorResponse } from './toss-market-indicator.mapper';

const MARKET_INDICATOR_RESPONSE = {
  result: {
    candles: [
      {
        timestamp: '2026-08-12T00:00:00.000+09:00',
        openPrice: '3220.12',
        highPrice: '3230.44',
        lowPrice: '3201.08',
        closePrice: '3215.68',
        volume: '531245678',
      },
      {
        timestamp: '2026-08-11T00:00:00.000+09:00',
        openPrice: '3200.10',
        highPrice: '3221.52',
        lowPrice: '3198.33',
        closePrice: '3210.24',
        volume: '498765432',
      },
    ],
    nextBefore: '2026-08-10T00:00:00.000+09:00',
  },
};

describe('mapTossMarketIndicatorResponse', () => {
  it('currency가 없는 시장 지표 캔들을 거래일 오름차순으로 변환한다', () => {
    const bars = mapTossMarketIndicatorResponse(MARKET_INDICATOR_RESPONSE);

    expect(bars?.map((bar) => bar.tradeDate.toISOString())).toEqual([
      '2026-08-11T00:00:00.000Z',
      '2026-08-12T00:00:00.000Z',
    ]);
    expect(bars?.map((bar) => bar.close.toString())).toEqual([
      '3210.24',
      '3215.68',
    ]);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-04-31'])(
    '존재하지 않는 날짜(%s)가 있으면 전체 응답을 거부한다',
    (invalidDate) => {
      const response = {
        result: {
          candles: [
            {
              ...MARKET_INDICATOR_RESPONSE.result.candles[0],
              timestamp: `${invalidDate}T00:00:00.000+09:00`,
            },
          ],
        },
      };

      expect(mapTossMarketIndicatorResponse(response)).toBeNull();
    },
  );

  it.each([
    { result: { items: [] } },
    { result: { candles: {} } },
    { result: [] },
  ])('result.candles 배열이 아니면 null을 반환한다', (response) => {
    expect(mapTossMarketIndicatorResponse(response)).toBeNull();
  });

  it.each([
    { ...MARKET_INDICATOR_RESPONSE.result.candles[0], timestamp: undefined },
    { ...MARKET_INDICATOR_RESPONSE.result.candles[0], closePrice: undefined },
    {
      ...MARKET_INDICATOR_RESPONSE.result.candles[0],
      closePrice: 'not-a-number',
    },
  ])('필수 필드가 잘못된 봉이 있으면 전체 응답을 거부한다', (candle) => {
    const response = { result: { candles: [candle] } };

    expect(mapTossMarketIndicatorResponse(response)).toBeNull();
  });
});
