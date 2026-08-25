import { MarketDataRateLimitError } from '../../market-data/domain/market-data-rate-limit.error';
import { MarketDataPort } from '../../market-data/domain/port/market-data.port';
import {
  MarketDataPrismaRepository,
  UniverseTicker,
} from '../../market-data/infrastructure/market-data.prisma.repository';
import { BackfillUniversePricesUsecase } from './backfill-universe-prices.usecase';

const decimal = (value: string) => ({
  toNumber: () => Number(value),
  toString: () => value,
});

const bar = (tradeDate: string, close = '100') => ({
  tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
  close: decimal(close),
  adjClose: decimal(close),
  volume: 10n,
  currency: 'KRW',
});

const ticker = (
  id: number,
  code: string,
  name = `종목${id}`,
): UniverseTicker => ({
  id,
  code,
  name,
  tossSymbol: code,
  krxMarket: 'KOSPI',
});

interface FixtureOptions {
  tickers?: UniverseTicker[];
  storedBarStats?: Map<
    number,
    { barCount: number; latestTradeDate: string; oldestTradeDate: string }
  >;
  fetchDailyBars?: jest.Mock;
  upsertDailyPrices?: jest.Mock;
}

const createFixture = (options: FixtureOptions = {}) => {
  const fetchDailyBars = options.fetchDailyBars ?? jest.fn();
  const upsertDailyPrices =
    options.upsertDailyPrices ??
    jest.fn().mockResolvedValue({ written: 0, blockedIntraday: 0 });
  const marketData = { fetchDailyBars } as unknown as MarketDataPort;
  const repository = {
    findUniverseTickers: jest
      .fn()
      .mockResolvedValue(options.tickers ?? [ticker(1, '005930')]),
    findStoredBarStats: jest
      .fn()
      .mockResolvedValue(options.storedBarStats ?? new Map()),
    upsertDailyPrices,
  } as unknown as MarketDataPrismaRepository;
  return {
    fetchDailyBars,
    upsertDailyPrices,
    usecase: new BackfillUniversePricesUsecase(marketData, repository),
  };
};

describe('BackfillUniversePricesUsecase', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('오름차순 페이지의 가장 오래된 봉이 목표 시작일에 닿으면 더 요청하지 않는다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockResolvedValue([bar('2021-08-20', '80'), bar('2021-09-01', '100')]);
    const fixture = createFixture({
      fetchDailyBars,
      storedBarStats: new Map([
        [
          1,
          {
            barCount: 200,
            latestTradeDate: '2026-08-22',
            oldestTradeDate: '2023-01-02',
          },
        ],
      ]),
      upsertDailyPrices: jest
        .fn()
        .mockResolvedValue({ written: 2, blockedIntraday: 0 }),
    });

    await expect(fixture.usecase.execute()).resolves.toEqual({
      targetCount: 1,
      skipped: 0,
      succeeded: 1,
      exhausted: 0,
      failed: 0,
      pagesFetched: 1,
      written: 2,
      blockedIntraday: 0,
      failures: [],
    });
    expect(fetchDailyBars).toHaveBeenCalledTimes(1);
    expect(fetchDailyBars).toHaveBeenCalledWith('005930', 200, {
      before: '2023-01-02T00:00:00.000+09:00',
    });
  });

  it('공급자가 빈 페이지를 반환하면 실패가 아닌 exhausted로 끝낸다', async () => {
    const fixture = createFixture({
      fetchDailyBars: jest.fn().mockResolvedValue([]),
    });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({
        succeeded: 0,
        exhausted: 1,
        failed: 0,
        pagesFetched: 1,
      }),
    );
    expect(fixture.upsertDailyPrices).not.toHaveBeenCalled();
  });

  it('같은 페이지가 반복되어 커서가 진전하지 않으면 유한 호출 후 exhausted로 끝낸다', async () => {
    const repeatedPage = [bar('2025-01-02', '90'), bar('2025-01-03', '100')];
    const fetchDailyBars = jest.fn().mockResolvedValue(repeatedPage);
    const upsertDailyPrices = jest
      .fn()
      .mockResolvedValue({ written: 2, blockedIntraday: 0 });
    const fixture = createFixture({ fetchDailyBars, upsertDailyPrices });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({
        succeeded: 0,
        exhausted: 1,
        failed: 0,
        pagesFetched: 2,
        written: 2,
      }),
    );
    expect(fetchDailyBars).toHaveBeenCalledTimes(2);
    expect(fetchDailyBars).toHaveBeenNthCalledWith(1, '005930', 200, {
      before: undefined,
    });
    expect(fetchDailyBars).toHaveBeenNthCalledWith(2, '005930', 200, {
      before: '2025-01-02T00:00:00.000+09:00',
    });
    expect(upsertDailyPrices).toHaveBeenCalledTimes(1);
  });

  it('이미 목표 시작일 이전까지 저장된 종목은 공급자를 호출하지 않고 건너뛴다', async () => {
    const fetchDailyBars = jest.fn();
    const fixture = createFixture({
      fetchDailyBars,
      storedBarStats: new Map([
        [
          1,
          {
            barCount: 1_300,
            latestTradeDate: '2026-08-22',
            oldestTradeDate: '2021-08-25',
          },
        ],
      ]),
    });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({ skipped: 1, succeeded: 0, exhausted: 0 }),
    );
    expect(fetchDailyBars).not.toHaveBeenCalled();
  });

  it('한 종목의 실패를 격리하고 다음 종목을 계속 처리한다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValueOnce(new Error('상장폐지'))
      .mockResolvedValueOnce([]);
    const fixture = createFixture({
      tickers: [ticker(1, '000001'), ticker(2, '000002')],
      fetchDailyBars,
    });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({
        targetCount: 2,
        failed: 1,
        exhausted: 1,
        failures: ['000001: 상장폐지'],
      }),
    );
    expect(fetchDailyBars).toHaveBeenCalledTimes(2);
    expect(fetchDailyBars).toHaveBeenNthCalledWith(2, '000002', 200, {
      before: undefined,
    });
  });

  it('429는 1초 뒤 한 번만 재시도하고 성공한 페이지로 계속한다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValueOnce(new MarketDataRateLimitError())
      .mockResolvedValueOnce([]);
    const fixture = createFixture({ fetchDailyBars });

    const pending = fixture.usecase.execute();
    await jest.advanceTimersByTimeAsync(999);
    expect(fetchDailyBars).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ exhausted: 1, failed: 0, pagesFetched: 1 }),
    );
    expect(fetchDailyBars).toHaveBeenCalledTimes(2);
  });
});
