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
      stalled: 0,
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

  it('같은 페이지가 반복되어 커서가 진전하지 않으면 유한 호출 후 stalled로 끝낸다', async () => {
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
        // 공급자 이상 신호이므로 정상 소진과 같은 칸에 담지 않는다.
        exhausted: 0,
        stalled: 1,
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

  // 실제 전종목 실행에서 상장 5년 미만 종목이 전부 이 경로로 끝났다. 토스가 커서 날짜의
  // 봉을 응답에 포함하므로 빈 배열이 아니고 커서도 안 움직인다 — 정상 소진이다.
  it('커서 날짜의 봉 하나만 돌아오면 이상이 아니라 소진으로 끝낸다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockResolvedValueOnce([bar('2023-12-22', '50'), bar('2024-03-05', '60')])
      .mockResolvedValueOnce([bar('2023-12-22', '50')]);
    const upsertDailyPrices = jest
      .fn()
      .mockResolvedValue({ written: 2, blockedIntraday: 0 });
    const fixture = createFixture({ fetchDailyBars, upsertDailyPrices });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({
        succeeded: 0,
        exhausted: 1,
        stalled: 0,
        failed: 0,
        pagesFetched: 2,
      }),
    );
  });

  // 개수만 보면 이 경우가 소진으로 숨는다. before 를 준 시각보다 미래인 봉이 왔다는 것은
  // 공급자가 커서를 무시했다는 뜻이라, 정상 소진이 아니라 이상 신호다.
  it('커서보다 미래인 봉 하나가 오면 소진이 아니라 미진전으로 센다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockResolvedValueOnce([bar('2023-12-22', '50'), bar('2024-03-05', '60')])
      .mockResolvedValueOnce([bar('2024-06-01', '70')]);
    const upsertDailyPrices = jest
      .fn()
      .mockResolvedValue({ written: 2, blockedIntraday: 0 });
    const fixture = createFixture({ fetchDailyBars, upsertDailyPrices });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({ exhausted: 0, stalled: 1, pagesFetched: 2 }),
    );
  });

  // 같은 페이지가 통째로 다시 오는 것은 공급자가 커서를 무시했다는 뜻이라 위와 구분한다.
  it('여러 봉이 통째로 다시 오면 소진이 아니라 미진전으로 센다', async () => {
    const repeated = [bar('2025-01-02', '90'), bar('2025-01-03', '100')];
    const fetchDailyBars = jest.fn().mockResolvedValue(repeated);
    const upsertDailyPrices = jest
      .fn()
      .mockResolvedValue({ written: 2, blockedIntraday: 0 });
    const fixture = createFixture({ fetchDailyBars, upsertDailyPrices });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({ exhausted: 0, stalled: 1, pagesFetched: 2 }),
    );
  });

  // 페이지네이션의 본질은 여러 장을 이어 받는 것인데, 종료 조건만 검증하면 정작 그
  // 성공 경로가 한 번도 실행되지 않는다.
  it('여러 페이지를 이어 받으며 직전 페이지의 최古 봉으로 커서를 갱신한다', async () => {
    const fetchDailyBars = jest
      .fn()
      .mockResolvedValueOnce([bar('2024-01-02', '80'), bar('2024-06-03', '90')])
      .mockResolvedValueOnce([bar('2022-05-10', '70'), bar('2023-12-28', '75')])
      .mockResolvedValueOnce([
        bar('2021-06-01', '60'),
        bar('2022-05-09', '65'),
      ]);
    const upsertDailyPrices = jest
      .fn()
      .mockResolvedValue({ written: 2, blockedIntraday: 0 });
    const fixture = createFixture({ fetchDailyBars, upsertDailyPrices });

    const result = await fixture.usecase.execute();

    expect(result).toEqual(
      expect.objectContaining({
        succeeded: 1,
        exhausted: 0,
        stalled: 0,
        failed: 0,
        pagesFetched: 3,
        written: 6,
      }),
    );
    expect(fetchDailyBars).toHaveBeenNthCalledWith(1, '005930', 200, {
      before: undefined,
    });
    expect(fetchDailyBars).toHaveBeenNthCalledWith(2, '005930', 200, {
      before: '2024-01-02T00:00:00.000+09:00',
    });
    expect(fetchDailyBars).toHaveBeenNthCalledWith(3, '005930', 200, {
      before: '2022-05-10T00:00:00.000+09:00',
    });
    expect(upsertDailyPrices).toHaveBeenCalledTimes(3);
  });

  // 조정가가 소급 변경된 구간을 갱신하려는 것이므로, 저장된 최古 봉부터 이어 받으면
  // 이미 있는 구간을 정확히 비껴가 아무것도 고치지 못한다.
  it('recheck 는 목표만큼 저장된 종목도 커서 없이 최신부터 다시 받는다', async () => {
    const storedBarStats = new Map([
      [
        1,
        {
          barCount: 1_400,
          latestTradeDate: '2026-08-24',
          oldestTradeDate: '2020-12-03',
        },
      ],
    ]);
    const fetchDailyBars = jest
      .fn()
      .mockResolvedValue([bar('2021-08-20', '80'), bar('2021-09-01', '100')]);
    const fixture = createFixture({ storedBarStats, fetchDailyBars });

    const result = await fixture.usecase.execute({ recheck: true });

    expect(result).toEqual(
      expect.objectContaining({ skipped: 0, succeeded: 1, pagesFetched: 1 }),
    );
    expect(fetchDailyBars).toHaveBeenCalledWith('005930', 200, {
      before: undefined,
    });
  });
});
