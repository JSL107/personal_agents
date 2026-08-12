import { MarketDataPort } from '../../market-data/domain/port/market-data.port';
import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import { CollectUniversePricesUsecase } from './collect-universe-prices.usecase';

const decimal = (value: string) => ({
  toNumber: () => Number(value),
  toString: () => value,
});

const bar = (date: string, close: string) => ({
  tradeDate: new Date(`${date}T00:00:00.000Z`),
  close: decimal(close),
  adjClose: decimal(close),
  volume: 10n,
  currency: 'KRW',
});

describe('CollectUniversePricesUsecase', () => {
  it('0봉, 4봉, 200봉 종목을 각각 최초 insert, 전체 upsert, 증분 upsert한다', async () => {
    const marketData = {
      fetchDailyBars: jest.fn().mockResolvedValue([bar('2026-08-11', '100')]),
    } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(
        [
          [1, '005930'],
          [2, '000660'],
          [3, '035420'],
        ].map(([id, code]) => ({
          id,
          code,
          name: `종목${id}`,
          tossSymbol: code,
          krxMarket: 'KOSPI',
        })),
      ),
      findStoredBarStats: jest.fn().mockResolvedValue(
        new Map([
          [2, { barCount: 4, latestTradeDate: '2026-08-08' }],
          [3, { barCount: 200, latestTradeDate: '2026-08-11' }],
        ]),
      ),
      findStoredCloses: jest
        .fn()
        .mockResolvedValue(new Map([['2026-08-11', '100']])),
      insertDailyPrices: jest
        .fn()
        .mockResolvedValue({ written: 1, blockedIntraday: 0 }),
      upsertDailyPrices: jest
        .fn()
        .mockResolvedValue({ written: 1, blockedIntraday: 0 }),
    } as unknown as MarketDataRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    await expect(usecase.execute()).resolves.toEqual({
      targetCount: 3,
      succeeded: 3,
      failed: 0,
      written: 3,
      blockedIntraday: 0,
      readjusted: 0,
      failures: [],
    });
    expect(marketData.fetchDailyBars).toHaveBeenNthCalledWith(1, '005930', 200);
    expect(marketData.fetchDailyBars).toHaveBeenNthCalledWith(2, '000660', 200);
    expect(marketData.fetchDailyBars).toHaveBeenNthCalledWith(3, '035420', 5);
    expect(repository.insertDailyPrices).toHaveBeenCalledTimes(1);
    expect(repository.upsertDailyPrices).toHaveBeenCalledTimes(2);
    expect(repository.findStoredCloses).toHaveBeenCalledTimes(1);
  });

  it('증분 종가가 다르면 해당 종목만 200봉을 재수집해 upsert한다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockResolvedValueOnce([bar('2026-08-11', '110')])
      .mockResolvedValueOnce([
        bar('2026-08-10', '90'),
        bar('2026-08-11', '110'),
      ]);
    const marketData = { fetchDailyBars } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '005930',
          name: '삼성전자',
          tossSymbol: '005930',
          krxMarket: 'KOSPI',
        },
      ]),
      findStoredBarStats: jest
        .fn()
        .mockResolvedValue(
          new Map([[1, { barCount: 200, latestTradeDate: '2026-08-10' }]]),
        ),
      findStoredCloses: jest
        .fn()
        .mockResolvedValue(new Map([['2026-08-11', '100']])),
      upsertDailyPrices: jest
        .fn()
        .mockResolvedValue({ written: 2, blockedIntraday: 0 }),
    } as unknown as MarketDataRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    const result = await usecase.execute();

    expect(fetchDailyBars).toHaveBeenNthCalledWith(1, '005930', 5);
    expect(fetchDailyBars).toHaveBeenNthCalledWith(2, '005930', 200);
    expect(repository.upsertDailyPrices).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ tickerId: 1, close: '90' }),
        expect.objectContaining({ tickerId: 1, close: '110' }),
      ]),
    );
    expect(result).toEqual(expect.objectContaining({ readjusted: 1 }));
  });

  it('종목별 실패를 격리하고 failures는 최대 20건만 남긴다', async () => {
    const tickers = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      code: String(index).padStart(6, '0'),
      name: `종목${index}`,
      tossSymbol: String(index).padStart(6, '0'),
      krxMarket: 'KOSPI',
    }));
    const marketData = {
      fetchDailyBars: jest.fn().mockRejectedValue(new Error('시세 실패')),
    } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(tickers),
      findStoredBarStats: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    const result = await usecase.execute();

    expect(result.targetCount).toBe(21);
    expect(result.failed).toBe(21);
    expect(result.failures).toHaveLength(20);
  });
});
