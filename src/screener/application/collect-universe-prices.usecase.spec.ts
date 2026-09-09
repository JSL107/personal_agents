import { MarketDataRateLimitError } from '../../market-data/domain/market-data-rate-limit.error';
import { MarketDataSymbolNotFoundError } from '../../market-data/domain/market-data-symbol-not-found.error';
import { MarketDataPort } from '../../market-data/domain/port/market-data.port';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';
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
  // 네 값을 서로 다른 숫자로 둔다. 종가와 같은 값을 쓰면 자리가 뒤바뀐 회귀가 통과한다.
  open: decimal(String(Number(close) - 1)),
  high: decimal(String(Number(close) + 3)),
  low: decimal(String(Number(close) - 4)),
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
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    await expect(usecase.execute()).resolves.toEqual({
      targetCount: 3,
      succeeded: 3,
      failed: 0,
      written: 3,
      blockedIntraday: 0,
      readjusted: 0,
      retried: 0,
      failures: [],
      dormant: [],
    });
    expect(marketData.fetchDailyBars).toHaveBeenNthCalledWith(1, '005930', 200);
    expect(marketData.fetchDailyBars).toHaveBeenNthCalledWith(2, '000660', 200);
    expect(marketData.fetchDailyBars).toHaveBeenNthCalledWith(3, '035420', 5);
    expect(repository.insertDailyPrices).toHaveBeenCalledTimes(1);
    expect(repository.upsertDailyPrices).toHaveBeenCalledTimes(2);
    expect(repository.findStoredCloses).toHaveBeenCalledTimes(1);
  });

  it('봉의 시가·고가·저가를 저장 입력으로 넘긴다', async () => {
    const marketData = {
      fetchDailyBars: jest.fn().mockResolvedValue([bar('2026-08-11', '100')]),
    } as unknown as MarketDataPort;
    const insertDailyPrices = jest
      .fn()
      .mockResolvedValue({ written: 1, blockedIntraday: 0 });
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '005930',
          name: '종목1',
          tossSymbol: '005930',
          krxMarket: 'KOSPI',
        },
      ]),
      findStoredBarStats: jest.fn().mockResolvedValue(new Map()),
      findStoredCloses: jest.fn().mockResolvedValue(new Map()),
      insertDailyPrices,
      upsertDailyPrices: jest
        .fn()
        .mockResolvedValue({ written: 1, blockedIntraday: 0 }),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    await usecase.execute();

    // 이 매핑은 backfill 과 따로 존재하므로 한쪽만 고쳐도 다른 쪽이 조용히 빠진다.
    expect(insertDailyPrices).toHaveBeenCalledWith([
      expect.objectContaining({
        open: '99',
        high: '103',
        low: '96',
        close: '100',
      }),
    ]);
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
    } as unknown as MarketDataPrismaRepository;
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
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    const result = await usecase.execute();

    expect(result.targetCount).toBe(21);
    expect(result.failed).toBe(21);
    expect(result.failures).toHaveLength(20);
  });

  it('마지막 봉이 2주 넘게 멈춘 종목의 실패는 공급 중단으로 분리한다', async () => {
    const daysAgo = (days: number): string =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 10);
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockRejectedValue(new MarketDataSymbolNotFoundError('094800')),
    } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(
        [
          [1, '094800'],
          [2, '005930'],
          [3, '999999'],
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
          [1, { barCount: 203, latestTradeDate: daysAgo(20) }],
          [2, { barCount: 203, latestTradeDate: daysAgo(3) }],
        ]),
      ),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    const result = await usecase.execute();

    expect(result.dormant).toEqual(['094800']);
    // 최근까지 봉이 있던 종목은 진짜 장애이므로 실패로 남아야 하고, 봉이 0개인 신규 종목의
    // 첫 수집 실패도 공급 중단으로 숨기지 않는다.
    expect(result.failed).toBe(2);
    expect(result.failures).toEqual([
      '005930: 시세 공급자에 없는 심볼입니다 — 094800',
      '999999: 시세 공급자에 없는 심볼입니다 — 094800',
    ]);
  });

  it('마지막 봉이 멈춘 종목이어도 404 가 아닌 실패는 실패로 남긴다', async () => {
    const marketData = {
      fetchDailyBars: jest.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '094800',
          name: '맵스리얼티',
          tossSymbol: '094800',
          krxMarket: 'KOSPI',
        },
      ]),
      findStoredBarStats: jest
        .fn()
        .mockResolvedValue(
          new Map([[1, { barCount: 203, latestTradeDate: '2020-01-02' }]]),
        ),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    const result = await usecase.execute();

    expect(result.dormant).toEqual([]);
    expect(result.failed).toBe(1);
  });

  it('공급 중단이 대상의 1%를 넘으면 공급자 장애로 보고 실패로 되돌린다', async () => {
    const tickers = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      code: String(index).padStart(6, '0'),
      name: `종목${index}`,
      tossSymbol: String(index).padStart(6, '0'),
      krxMarket: 'KOSPI',
    }));
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockRejectedValue(new MarketDataSymbolNotFoundError('000000')),
    } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(tickers),
      findStoredBarStats: jest
        .fn()
        .mockResolvedValue(
          new Map(
            tickers.map((ticker) => [
              ticker.id,
              { barCount: 203, latestTradeDate: '2020-01-02' },
            ]),
          ),
        ),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    const result = await usecase.execute();

    // 조용히 넘기면 실패 0 으로 보고돼 공급자 장애가 며칠 묻힌다.
    expect(result.dormant).toEqual([]);
    expect(result.failed).toBe(100);
    expect(result.failures).toHaveLength(20);
  });

  it('429가 한 번 발생하면 1초 뒤 한 번 재시도해 성공과 retried를 집계한다', async () => {
    jest.useFakeTimers();
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValueOnce(new MarketDataRateLimitError())
      .mockResolvedValueOnce([bar('2026-08-11', '100')]);
    const marketData = { fetchDailyBars } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000020',
          name: '동화약품',
          tossSymbol: '000020',
          krxMarket: 'KOSPI',
        },
      ]),
      findStoredBarStats: jest.fn().mockResolvedValue(new Map()),
      insertDailyPrices: jest
        .fn()
        .mockResolvedValue({ written: 1, blockedIntraday: 0 }),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    try {
      const pending = usecase.execute();
      await jest.advanceTimersByTimeAsync(999);
      expect(fetchDailyBars).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual(
        expect.objectContaining({ succeeded: 1, failed: 0, retried: 1 }),
      );
      expect(fetchDailyBars).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('429가 두 번 발생하면 재시도를 더 하지 않고 실패로 남긴다', async () => {
    jest.useFakeTimers();
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValue(new MarketDataRateLimitError());
    const marketData = { fetchDailyBars } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000520',
          name: '삼일제약',
          tossSymbol: '000520',
          krxMarket: 'KOSPI',
        },
      ]),
      findStoredBarStats: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    try {
      const pending = usecase.execute();
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toEqual(
        expect.objectContaining({ succeeded: 0, failed: 1, retried: 0 }),
      );
      expect(fetchDailyBars).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('429가 아닌 오류는 기다리거나 재시도하지 않고 즉시 실패로 남긴다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValue(new Error('server error'));
    const marketData = { fetchDailyBars } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000970',
          name: '한국주철관',
          tossSymbol: '000970',
          krxMarket: 'KOSPI',
        },
      ]),
      findStoredBarStats: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    await expect(usecase.execute()).resolves.toEqual(
      expect.objectContaining({ succeeded: 0, failed: 1, retried: 0 }),
    );
    expect(fetchDailyBars).toHaveBeenCalledTimes(1);
  });

  it('최초 조회와 소급 재수집은 종목당 429 재시도 예산 한 번을 공유한다', async () => {
    jest.useFakeTimers();
    const fetchDailyBars = jest
      .fn()
      .mockRejectedValueOnce(new MarketDataRateLimitError())
      .mockResolvedValueOnce([bar('2026-08-11', '110')])
      .mockRejectedValueOnce(new MarketDataRateLimitError());
    const marketData = { fetchDailyBars } as unknown as MarketDataPort;
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '001130',
          name: '대한제분',
          tossSymbol: '001130',
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
    } as unknown as MarketDataPrismaRepository;
    const usecase = new CollectUniversePricesUsecase(marketData, repository);

    try {
      const pending = usecase.execute();
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toEqual(
        expect.objectContaining({ succeeded: 0, failed: 1, retried: 0 }),
      );
      expect(fetchDailyBars).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
