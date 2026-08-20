import { DecimalValue } from '../../market-data/domain/market-data.type';
import { IndicatorBar } from '../../market-data/domain/stock-indicator';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';
import { ScreeningHistoryPrismaRepository } from '../infrastructure/screening-history.prisma.repository';
import { ScreenUniverseUsecase } from './screen-universe.usecase';

const decimal = (value: number): DecimalValue => ({
  toNumber: () => value,
  toString: () => String(value),
});

const historyRepositoryStub = (): {
  saveScreeningRun: jest.Mock;
  asRepository: ScreeningHistoryPrismaRepository;
} => {
  const saveScreeningRun = jest
    .fn()
    .mockResolvedValue({ runId: 7, recordedCount: 0 });
  return {
    saveScreeningRun,
    asRepository: {
      saveScreeningRun,
    } as unknown as ScreeningHistoryPrismaRepository,
  };
};

const risingBars = (count: number, endDate: string): IndicatorBar[] => {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => ({
    tradeDate: new Date(
      end.getTime() - (count - 1 - index) * 24 * 60 * 60 * 1_000,
    ),
    // 유동성 하한을 통과시키는 원본 종가를 별도로 고정해 추세용 조정 종가와 의도를 분리한다.
    close: decimal(10_000),
    adjClose: decimal(index + 1),
    volume: index === count - 1 ? 150_000n : 50_000n,
  }));
};

describe('ScreenUniverseUsecase', () => {
  it('유니버스를 200종목씩 읽고 공통 기준일과 다른 종목을 제외해 집계한다', async () => {
    const tickers = Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      code: String(index + 1).padStart(6, '0'),
      name: `종목${index + 1}`,
      tossSymbol: String(index + 1).padStart(6, '0'),
      krxMarket: 'KOSPI',
    }));
    const findBarsForTickers = jest
      .fn()
      .mockResolvedValueOnce(new Map([[1, risingBars(200, '2026-08-11')]]))
      .mockResolvedValueOnce(new Map([[201, risingBars(200, '2026-08-12')]]));
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(tickers),
      findBarsForTickers,
    } as unknown as MarketDataPrismaRepository;
    const usecase = new ScreenUniverseUsecase(
      repository,
      historyRepositoryStub().asRepository,
    );

    const result = await usecase.execute({ strategy: 'LONG_TERM', limit: 1 });

    expect(findBarsForTickers).toHaveBeenNthCalledWith(
      1,
      tickers.slice(0, 200).map((ticker) => ticker.id),
      200,
    );
    expect(findBarsForTickers).toHaveBeenNthCalledWith(2, [201], 200);
    expect(result).toEqual({
      strategy: 'LONG_TERM',
      ruleVersion: 2,
      universeCount: 201,
      evaluatedCount: 2,
      staleCount: 1,
      passedCount: 1,
      stocks: [expect.objectContaining({ code: '000201' })],
      includedIndicators: [],
      asOf: '2026-08-12',
      recordedRunId: null,
    });
  });

  it('봉이 전혀 없으면 평가·통과 없이 asOf도 null이다', async () => {
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
      findBarsForTickers: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new ScreenUniverseUsecase(
      repository,
      historyRepositoryStub().asRepository,
    );

    await expect(usecase.execute({ strategy: 'SWING' })).resolves.toEqual({
      strategy: 'SWING',
      ruleVersion: 2,
      universeCount: 1,
      evaluatedCount: 0,
      staleCount: 0,
      passedCount: 0,
      stocks: [],
      includedIndicators: [],
      asOf: null,
      recordedRunId: null,
    });
  });

  it('요청 종목은 스크리너 필터에서 탈락해도 includedIndicators에 반환한다', async () => {
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
      findBarsForTickers: jest
        .fn()
        .mockResolvedValue(new Map([[1, risingBars(59, '2026-08-13')]])),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new ScreenUniverseUsecase(
      repository,
      historyRepositoryStub().asRepository,
    );

    const result = await usecase.execute({
      strategy: 'LONG_TERM',
      includeTickerIds: [1],
    });

    expect(result.stocks).toEqual([]);
    expect(result.includedIndicators).toEqual([
      expect.objectContaining({
        tickerId: 1,
        code: '005930',
        name: '삼성전자',
        indicators: expect.objectContaining({ barCount: 59 }),
      }),
    ]);
  });

  it('요청 종목이어도 asOf와 다른 stale 지표는 includedIndicators에서 제외한다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '005930',
          name: '삼성전자',
          tossSymbol: '005930',
          krxMarket: 'KOSPI',
        },
        {
          id: 2,
          code: '000660',
          name: 'SK하이닉스',
          tossSymbol: '000660',
          krxMarket: 'KOSPI',
        },
      ]),
      findBarsForTickers: jest.fn().mockResolvedValue(
        new Map([
          [1, risingBars(200, '2026-08-12')],
          [2, risingBars(200, '2026-08-13')],
        ]),
      ),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new ScreenUniverseUsecase(
      repository,
      historyRepositoryStub().asRepository,
    );

    const result = await usecase.execute({
      strategy: 'LONG_TERM',
      includeTickerIds: [1],
    });

    expect(result.asOf).toBe('2026-08-13');
    expect(result.includedIndicators).toEqual([]);
  });

  it('includeTickerIds 미지정이면 기존 stocks를 유지하고 includedIndicators는 비운다', async () => {
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
      findBarsForTickers: jest
        .fn()
        .mockResolvedValue(new Map([[1, risingBars(200, '2026-08-13')]])),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new ScreenUniverseUsecase(
      repository,
      historyRepositoryStub().asRepository,
    );

    const result = await usecase.execute({ strategy: 'LONG_TERM' });

    expect(result.stocks).toEqual([
      expect.objectContaining({ tickerId: 1, code: '005930' }),
    ]);
    expect(result.includedIndicators).toEqual([]);
  });
  it('record를 켜면 limit 안의 통과 목록만 남기고 전체 통과 수는 회차에 적는다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '005930',
          name: '삼성전자',
          tossSymbol: '005930',
          krxMarket: 'KOSPI',
        },
        {
          id: 2,
          code: '000660',
          name: 'SK하이닉스',
          tossSymbol: '000660',
          krxMarket: 'KOSPI',
        },
      ]),
      findBarsForTickers: jest.fn().mockResolvedValue(
        new Map([
          [1, risingBars(200, '2026-08-13')],
          [2, risingBars(200, '2026-08-13')],
        ]),
      ),
    } as unknown as MarketDataPrismaRepository;
    const history = historyRepositoryStub();
    const usecase = new ScreenUniverseUsecase(repository, history.asRepository);

    const result = await usecase.execute({
      strategy: 'LONG_TERM',
      limit: 1,
      record: true,
    });

    expect(result.recordedRunId).toBe(7);
    expect(result.passedCount).toBe(2);
    expect(history.saveScreeningRun).toHaveBeenCalledTimes(1);
    const saved = history.saveScreeningRun.mock.calls[0][0];
    expect(saved).toEqual(
      expect.objectContaining({
        strategy: 'LONG_TERM',
        asOf: new Date('2026-08-13T00:00:00.000Z'),
        ruleVersion: 2,
        universeCount: 2,
        evaluatedCount: 2,
        staleCount: 0,
        // 통과는 2종목이지만 프롬프트에 실린 것은 1종목이다 — 둘을 같은 수로 뭉치면
        // "보여주지도 않은 종목을 모델이 안 샀다" 는 잘못된 대조군이 만들어진다.
        passedCount: 2,
      }),
    );
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        score: result.stocks[0].score,
        tickerId: result.stocks[0].tickerId,
      }),
    );
    expect(saved.items[0].indicatorSnapshot).toEqual(
      result.stocks[0].indicators,
    );
  });

  it('record를 켜지 않으면 원장에 남기지 않는다', async () => {
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
      findBarsForTickers: jest
        .fn()
        .mockResolvedValue(new Map([[1, risingBars(200, '2026-08-13')]])),
    } as unknown as MarketDataPrismaRepository;
    const history = historyRepositoryStub();
    const usecase = new ScreenUniverseUsecase(repository, history.asRepository);

    const result = await usecase.execute({ strategy: 'LONG_TERM' });

    expect(result.stocks).toHaveLength(1);
    expect(result.recordedRunId).toBeNull();
    expect(history.saveScreeningRun).not.toHaveBeenCalled();
  });

  it('기준일이 없으면 record를 켜도 남길 회차가 없다', async () => {
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
      findBarsForTickers: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataPrismaRepository;
    const history = historyRepositoryStub();
    const usecase = new ScreenUniverseUsecase(repository, history.asRepository);

    const result = await usecase.execute({
      strategy: 'LONG_TERM',
      record: true,
    });

    expect(result.asOf).toBeNull();
    expect(result.recordedRunId).toBeNull();
    expect(history.saveScreeningRun).not.toHaveBeenCalled();
  });

  it('통과가 0건이어도 record를 켜면 회차는 남는다', async () => {
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
      findBarsForTickers: jest
        .fn()
        .mockResolvedValue(new Map([[1, risingBars(59, '2026-08-13')]])),
    } as unknown as MarketDataPrismaRepository;
    const history = historyRepositoryStub();
    const usecase = new ScreenUniverseUsecase(repository, history.asRepository);

    const result = await usecase.execute({
      strategy: 'LONG_TERM',
      record: true,
    });

    // 통과 0건은 결과가 없는 것이 아니라 "그날 규칙이 아무도 통과시키지 않았다" 는 결과다.
    // 회차를 남기지 않으면 규칙이 너무 좁았던 날과 스크리너가 안 돈 날이 구분되지 않는다.
    expect(result.passedCount).toBe(0);
    expect(result.recordedRunId).toBe(7);
    expect(history.saveScreeningRun.mock.calls[0][0].items).toEqual([]);
  });
});
