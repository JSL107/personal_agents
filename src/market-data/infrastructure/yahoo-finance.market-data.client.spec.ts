import { Logger } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';

import { YahooFinanceMarketDataClient } from './yahoo-finance.market-data.client';

jest.mock('yahoo-finance2');

const quote = jest.fn();
const chart = jest.fn();

describe('YahooFinanceMarketDataClient.fetchUsdKrwRate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    (YahooFinance as jest.MockedClass<typeof YahooFinance>).mockImplementation(
      () => ({ chart, quote }) as never,
    );
  });

  it('KRW=X regularMarketPrice 를 문자열로 반환한다', async () => {
    quote.mockResolvedValue({ regularMarketPrice: 1476.3 });
    const client = new YahooFinanceMarketDataClient();

    const result = await client.fetchUsdKrwRate();

    expect(quote).toHaveBeenCalledWith('KRW=X');
    expect(result).toBe('1476.3');
  });

  it('regularMarketPrice 가 없으면 null 을 반환한다', async () => {
    quote.mockResolvedValue({ currency: 'KRW' });
    const client = new YahooFinanceMarketDataClient();

    await expect(client.fetchUsdKrwRate()).resolves.toBeNull();
  });

  it('Yahoo 조회가 실패하면 null 을 반환한다', async () => {
    quote.mockRejectedValue(new Error('timeout'));
    const client = new YahooFinanceMarketDataClient();

    await expect(client.fetchUsdKrwRate()).resolves.toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    '유효하지 않은 환율 %s 를 거부한다',
    async (regularMarketPrice) => {
      quote.mockResolvedValue({ regularMarketPrice });
      const client = new YahooFinanceMarketDataClient();

      await expect(client.fetchUsdKrwRate()).resolves.toBeNull();
    },
  );
});

describe('YahooFinanceMarketDataClient.fetchDailyBars', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (YahooFinance as jest.MockedClass<typeof YahooFinance>).mockImplementation(
      () => ({ chart, quote }) as never,
    );
  });

  it('일봉 응답에 통화가 없으면 명시적으로 실패한다', async () => {
    chart.mockResolvedValue({
      meta: {},
      quotes: [],
    });
    const client = new YahooFinanceMarketDataClient();

    await expect(client.fetchDailyBars('AAPL', 5)).rejects.toThrow(/currency/);
  });
});
