import {
  fetchDailyBarsWithRateLimitRetry,
  RATE_LIMIT_RETRY_DELAY_MS,
} from './fetch-daily-bars-with-rate-limit-retry';
import { DailyBar } from './market-data.type';
import { MarketDataRateLimitError } from './market-data-rate-limit.error';
import { MarketDataPort } from './port/market-data.port';

const bar = { tradeDate: new Date('2026-10-08T00:00:00.000Z') } as DailyBar;

const buildPort = (fetchDailyBars: jest.Mock): MarketDataPort => ({
  fetchDailyBars,
  fetchUsdKrwRate: jest.fn(),
});

describe('fetchDailyBarsWithRateLimitRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('한도 초과면 쉬었다가 같은 인자로 한 번 더 조회한다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValueOnce(new MarketDataRateLimitError())
      .mockResolvedValueOnce([bar]);

    const pending = fetchDailyBarsWithRateLimitRetry(
      buildPort(fetchDailyBars),
      'A003490',
      2,
      { adjusted: false },
    );
    await jest.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_DELAY_MS - 1);
    expect(fetchDailyBars).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual([bar]);
    expect(fetchDailyBars).toHaveBeenNthCalledWith(2, 'A003490', 2, {
      adjusted: false,
    });
  });

  it('재시도도 한도 초과면 그 오류를 그대로 올린다 — 재시도는 한 번뿐이다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValue(new MarketDataRateLimitError());

    const pending = fetchDailyBarsWithRateLimitRetry(
      buildPort(fetchDailyBars),
      'A003490',
      2,
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(
      MarketDataRateLimitError,
    );
    await jest.advanceTimersByTimeAsync(RATE_LIMIT_RETRY_DELAY_MS);

    await assertion;
    expect(fetchDailyBars).toHaveBeenCalledTimes(2);
  });

  it('한도 초과가 아닌 오류는 재시도하지 않는다', async () => {
    const fetchDailyBars = jest.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      fetchDailyBarsWithRateLimitRetry(buildPort(fetchDailyBars), 'A003490', 2),
    ).rejects.toThrow('timeout');
    expect(fetchDailyBars).toHaveBeenCalledTimes(1);
  });
});
