import { MarketDataPrismaRepository } from '../../../market-data/infrastructure/market-data.prisma.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockMonitorPrismaRepository as ProductionStockMonitorRepository } from './stock-monitor.prisma.repository';

class StockMonitorPrismaRepository extends ProductionStockMonitorRepository {
  constructor(
    prisma: PrismaService,
    marketDataRepository: MarketDataPrismaRepository = {
      upsertDailyPrice: jest.fn().mockResolvedValue({
        written: 1,
        blockedIntraday: 0,
      }),
    } as unknown as MarketDataPrismaRepository,
  ) {
    super(prisma, marketDataRepository);
  }
}

describe('StockMonitorPrismaRepository daily price delegation', () => {
  it('공유 시세 repository에 단건 쓰기를 위임한다', async () => {
    const prisma = {} as PrismaService;
    const upsertDailyPrice = jest.fn().mockResolvedValue({
      written: 1,
      blockedIntraday: 0,
    });
    const marketData = {
      upsertDailyPrice,
    } as unknown as MarketDataPrismaRepository;
    const repository = new StockMonitorPrismaRepository(prisma, marketData);
    const input = {
      tickerId: 3,
      tradeDate: new Date('2026-08-11T00:00:00.000Z'),
      close: '71200',
      adjClose: '71200',
      volume: 10n,
    };

    await repository.upsertDailyPrice(input);

    expect(upsertDailyPrice).toHaveBeenCalledWith(input);
  });
});

describe('StockMonitorPrismaRepository alert outcome', () => {
  it('지정 horizon의 outcome이 없는 알림만 조회한다', async () => {
    const tradeDate = new Date('2026-07-16T00:00:00.000Z');
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 11, tickerId: 3, tradeDate }]);
    const prisma = { stockAlert: { findMany } } as unknown as PrismaService;
    const repository = new StockMonitorPrismaRepository(prisma);

    const result = await repository.findAlertsNeedingOutcome(5);

    expect(findMany).toHaveBeenCalledWith({
      where: { outcomes: { none: { horizonDays: 5 } } },
      orderBy: { id: 'asc' },
      select: { id: true, tickerId: true, tradeDate: true },
    });
    expect(result).toEqual([{ alertId: 11, tickerId: 3, tradeDate }]);
  });

  it('미채점 알림이 남은 종목을 시장별로 중복 없이 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { tickerId: 3, ticker: { tossSymbol: 'A3', name: '가나다' } },
      // tossSymbol 이 없으면 시세를 부를 방법이 없다 — 대상에서 빠져야 한다.
      { tickerId: 4, ticker: { tossSymbol: null, name: '심볼없음' } },
    ]);
    const prisma = { stockAlert: { findMany } } as unknown as PrismaService;
    const repository = new StockMonitorPrismaRepository(prisma);

    const result = await repository.findTickersWithUnscoredAlerts({
      marketCountry: 'KR',
      horizonDays: 5,
    });

    // distinct 가 빠지면 한 종목에 알림이 여러 건 남았을 때 같은 종목을 몇 번이고 다시 부른다.
    expect(findMany).toHaveBeenCalledWith({
      where: {
        outcomes: { none: { horizonDays: 5 } },
        ticker: { marketCountry: 'KR', tossSymbol: { not: null } },
      },
      orderBy: { tickerId: 'asc' },
      distinct: ['tickerId'],
      select: {
        tickerId: true,
        ticker: { select: { tossSymbol: true, name: true } },
      },
    });
    expect(result).toEqual([
      { tickerId: 3, symbol: 'A3', tickerName: '가나다' },
    ]);
  });

  it('발화일 이후 가격을 거래일 오름차순으로 조회한다', async () => {
    const tradeDate = new Date('2026-07-16T00:00:00.000Z');
    const prices = [{ tradeDate, adjClose: { toString: () => '100' } }];
    const findMany = jest.fn().mockResolvedValue(prices);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new StockMonitorPrismaRepository(prisma);

    const result = await repository.findDailyPricesSince(3, tradeDate);

    expect(findMany).toHaveBeenCalledWith({
      where: { tickerId: 3, tradeDate: { gte: tradeDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, adjClose: true },
    });
    expect(result).toBe(prices);
  });

  it('(alertId, horizonDays) 유니크 키로 outcome을 upsert한다', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = { alertOutcome: { upsert } } as unknown as PrismaService;
    const repository = new StockMonitorPrismaRepository(prisma);
    const input = {
      alertId: 11,
      horizonDays: 5,
      firedPrice: '100.0000',
      horizonPrice: '110.0000',
      returnPct: '10.0000',
    };

    await repository.upsertAlertOutcome(input);

    expect(upsert).toHaveBeenCalledWith({
      where: {
        alertId_horizonDays: { alertId: 11, horizonDays: 5 },
      },
      create: input,
      update: {},
    });
  });
});

const makePrisma = () => ({
  holding: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  holdingChange: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  dailyFxRate: {
    upsert: jest.fn().mockResolvedValue(undefined),
    findUnique: jest.fn(),
  },
});

describe('StockMonitorPrismaRepository', () => {
  it('TOSS 현재 보유를 시장 구분 없이 최신 종가와 조회한다', async () => {
    const prisma = makePrisma();
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await repository.findPortfolioPositions();

    expect(prisma.holding.findMany).toHaveBeenCalledWith({
      where: { ticker: { source: 'TOSS' } },
      orderBy: { effectiveDate: 'desc' },
      include: {
        ticker: {
          include: {
            dailyPrices: {
              orderBy: { tradeDate: 'desc' },
              take: 1,
            },
          },
        },
      },
    });
  });

  it('전환 이력이 있어도 현재 등록 경로의 보유만 포지션으로 반환한다', async () => {
    const prisma = makePrisma();
    const currentQuantity = { isZero: () => false };
    const currentClose = { toString: () => '200' };
    const databaseHoldings = [
      {
        tickerId: 1,
        quantity: currentQuantity,
        currency: 'KRW',
        ticker: {
          source: 'TOSS',
          exposureRegion: 'KR',
          exposureDirection: 'LONG',
          dailyPrices: [{ close: currentClose }],
        },
      },
      {
        tickerId: 2,
        quantity: { isZero: () => false },
        currency: 'KRW',
        ticker: {
          source: 'YAHOO',
          exposureRegion: 'KR',
          exposureDirection: 'LONG',
          dailyPrices: [],
        },
      },
    ];
    // Prisma mock은 where를 실행하지 않으므로 DB 필터 이후 반환 모양을 직접 지정한다.
    prisma.holding.findMany.mockResolvedValue([databaseHoldings[0]]);
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.findPortfolioPositions();

    expect(prisma.holding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ticker: { source: 'TOSS' } },
      }),
    );
    expect(result).toEqual([
      {
        region: 'KR',
        direction: 'LONG',
        currency: 'KRW',
        quantity: currentQuantity,
        close: currentClose,
      },
    ]);
  });

  it('최신 수량이 남은 가상 보유만 노출 분류와 최신 종가로 반환한다', async () => {
    const prisma = makePrisma();
    const quantity = { isZero: () => false };
    const close = { toString: () => '123.45' };
    prisma.holding.findMany.mockResolvedValue([
      {
        tickerId: 1,
        quantity,
        currency: 'USD',
        ticker: {
          exposureRegion: 'US',
          exposureDirection: 'LONG',
          dailyPrices: [{ close }],
        },
      },
      {
        tickerId: 2,
        quantity: { isZero: () => true },
        currency: 'KRW',
        ticker: {
          exposureRegion: 'KR',
          exposureDirection: 'SHORT',
          dailyPrices: [{ close }],
        },
      },
      {
        tickerId: 2,
        quantity,
        currency: 'KRW',
        ticker: {
          exposureRegion: 'KR',
          exposureDirection: 'SHORT',
          dailyPrices: [{ close }],
        },
      },
    ]);
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.findPortfolioPositions();

    expect(result).toEqual([
      {
        region: 'US',
        direction: 'LONG',
        currency: 'USD',
        quantity,
        close,
      },
    ]);
  });

  it('현재 가상 보유 중 하나라도 종가가 없으면 부분 비중을 반환하지 않는다', async () => {
    const prisma = makePrisma();
    const quantity = { isZero: () => false };
    prisma.holding.findMany.mockResolvedValue([
      {
        tickerId: 1,
        quantity,
        currency: 'KRW',
        ticker: {
          exposureRegion: 'KR',
          exposureDirection: 'LONG',
          dailyPrices: [{ close: { toString: () => '100' } }],
        },
      },
      {
        tickerId: 2,
        quantity,
        currency: 'USD',
        ticker: {
          exposureRegion: 'US',
          exposureDirection: 'LONG',
          dailyPrices: [],
        },
      },
    ]);
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await expect(repository.findPortfolioPositions()).resolves.toEqual([]);
  });

  it('현재 보유 종목을 marketCountry 로 필터한다', async () => {
    const prisma = makePrisma();
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await repository.findCurrentHoldings({ marketCountry: 'US' });

    expect(prisma.holding.findMany).toHaveBeenCalledWith({
      where: { ticker: { marketCountry: 'US' } },
      orderBy: { effectiveDate: 'desc' },
      include: { ticker: true },
    });
  });

  it('Yahoo symbol이 비어 있어도 tossSymbol이 있는 현재 보유 종목을 반환한다', async () => {
    const prisma = makePrisma();
    const quantity = { isZero: () => false };
    const avgPrice = { toString: () => '100000' };
    prisma.holding.findMany.mockResolvedValue([
      {
        tickerId: 1,
        effectiveDate: new Date('2026-08-06T00:00:00.000Z'),
        quantity,
        avgPrice,
        ticker: {
          name: 'KODEX 미국AI테크커버드콜',
          tossSymbol: '483280',
        },
      },
    ]);
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.findCurrentHoldings({
      marketCountry: 'KR',
    });

    expect(result).toEqual([
      {
        tickerId: 1,
        tickerName: 'KODEX 미국AI테크커버드콜',
        symbol: '483280',
        quantity,
        avgPrice,
      },
    ]);
  });

  it('최신 보유 행이 전량 매도면 이전 보유 행이 있어도 감시에서 제외한다', async () => {
    const prisma = makePrisma();
    const avgPrice = { toString: () => '100000' };
    const ticker = { name: '삼성전자', tossSymbol: '005930' };
    prisma.holding.findMany.mockResolvedValue([
      {
        tickerId: 1,
        effectiveDate: new Date('2026-08-06T00:00:00.000Z'),
        quantity: { isZero: () => true },
        avgPrice,
        ticker,
      },
      {
        tickerId: 1,
        effectiveDate: new Date('2026-08-05T00:00:00.000Z'),
        quantity: { isZero: () => false },
        avgPrice,
        ticker,
      },
    ]);
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.findCurrentHoldings({
      marketCountry: 'KR',
    });

    expect(result).toEqual([]);
  });

  it('최신 보유 행의 수량이 남아 있으면 감시 대상에 포함한다', async () => {
    const prisma = makePrisma();
    const latestQuantity = { isZero: () => false };
    const avgPrice = { toString: () => '100000' };
    const ticker = { name: '삼성전자', tossSymbol: '005930' };
    prisma.holding.findMany.mockResolvedValue([
      {
        tickerId: 1,
        effectiveDate: new Date('2026-08-06T00:00:00.000Z'),
        quantity: latestQuantity,
        avgPrice,
        ticker,
      },
      {
        tickerId: 1,
        effectiveDate: new Date('2026-08-05T00:00:00.000Z'),
        quantity: { isZero: () => false },
        avgPrice,
        ticker,
      },
    ]);
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.findCurrentHoldings({
      marketCountry: 'KR',
    });

    expect(result).toEqual([
      {
        tickerId: 1,
        tickerName: '삼성전자',
        symbol: '005930',
        quantity: latestQuantity,
        avgPrice,
      },
    ]);
  });

  it('일별 환율을 pair 와 rateDate 기준으로 upsert 한다', async () => {
    const prisma = makePrisma();
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const rateDate = new Date('2026-07-23T00:00:00.000Z');

    await repository.upsertFxRate({
      pair: 'USDKRW',
      rateDate,
      rate: '1476.3',
    });

    expect(prisma.dailyFxRate.upsert).toHaveBeenCalledWith({
      where: { pair_rateDate: { pair: 'USDKRW', rateDate } },
      create: { pair: 'USDKRW', rateDate, rate: '1476.3' },
      update: { rate: '1476.3', fetchedAt: expect.any(Date) },
    });
  });

  it('저장된 환율을 정밀도 보존 문자열로 반환한다', async () => {
    const prisma = makePrisma();
    prisma.dailyFxRate.findUnique.mockResolvedValue({
      rate: { toString: () => '1476.300000' },
    });
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const rateDate = new Date('2026-07-23T00:00:00.000Z');

    const result = await repository.findFxRate({
      pair: 'USDKRW',
      rateDate,
    });

    expect(prisma.dailyFxRate.findUnique).toHaveBeenCalledWith({
      where: { pair_rateDate: { pair: 'USDKRW', rateDate } },
      select: { rate: true },
    });
    expect(result).toBe('1476.300000');
  });

  // 매매 판정의 기준선. 수량이나 종목명이 빠지면 판정이 조용히 무력화되므로 반환 모양을 고정한다.
  it('직전 브로커 잔고를 수량·종목명까지 담아 반환한다', async () => {
    const prisma = makePrisma();
    const quantity = { isZero: () => false };
    const avgPrice = { toString: () => '11044.7' };
    prisma.holding.findMany.mockResolvedValue([
      {
        tickerId: 7,
        quantity,
        avgPrice,
        currency: 'KRW',
        ticker: {
          name: 'KODEX 인버스',
          tossSymbol: '114800',
          code: '114800',
        },
      },
    ]);
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.findCurrentBrokerHoldings();

    expect(prisma.holding.findMany).toHaveBeenCalledWith({
      where: { ticker: { source: 'TOSS' } },
      orderBy: { effectiveDate: 'desc' },
      include: { ticker: true },
    });
    expect(result).toEqual([
      {
        tickerId: 7,
        tickerName: 'KODEX 인버스',
        symbol: '114800',
        quantity,
        avgPrice,
        currency: 'KRW',
      },
    ]);
  });

  it('매매 사건을 한 번에 적재한다', async () => {
    const prisma = makePrisma();
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const effectiveDate = new Date('2026-08-06T00:00:00.000Z');
    const changes = [
      {
        tickerId: 7,
        kind: 'INCREASED' as const,
        previousQuantity: '50',
        quantity: '80',
        previousAvgPrice: '11044.7',
        avgPrice: '10800',
        currency: 'KRW',
        effectiveDate,
        fingerprint: 'a'.repeat(64),
      },
    ];

    await repository.recordHoldingChanges(changes);

    // skipDuplicates 가 빠지면 겹친 실행이 같은 지문으로 삽입을 시도해 동기화 전체가 throw 한다.
    expect(prisma.holdingChange.createMany).toHaveBeenCalledWith({
      data: changes,
      skipDuplicates: true,
    });
  });

  it('적재할 사건이 없으면 DB 를 건드리지 않는다', async () => {
    const prisma = makePrisma();
    const repository = new StockMonitorPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await repository.recordHoldingChanges([]);

    expect(prisma.holdingChange.createMany).not.toHaveBeenCalled();
  });
});
