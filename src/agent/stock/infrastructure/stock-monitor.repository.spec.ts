import { PrismaService } from '../../../prisma/prisma.service';
import { StockMonitorRepository } from './stock-monitor.repository';

describe('StockMonitorRepository alert outcome', () => {
  it('지정 horizon의 outcome이 없는 알림만 조회한다', async () => {
    const tradeDate = new Date('2026-07-16T00:00:00.000Z');
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 11, tickerId: 3, tradeDate }]);
    const prisma = { stockAlert: { findMany } } as unknown as PrismaService;
    const repository = new StockMonitorRepository(prisma);

    const result = await repository.findAlertsNeedingOutcome(5);

    expect(findMany).toHaveBeenCalledWith({
      where: { outcomes: { none: { horizonDays: 5 } } },
      orderBy: { id: 'asc' },
      select: { id: true, tickerId: true, tradeDate: true },
    });
    expect(result).toEqual([{ alertId: 11, tickerId: 3, tradeDate }]);
  });

  it('발화일 이후 가격을 거래일 오름차순으로 조회한다', async () => {
    const tradeDate = new Date('2026-07-16T00:00:00.000Z');
    const prices = [{ tradeDate, adjClose: { toString: () => '100' } }];
    const findMany = jest.fn().mockResolvedValue(prices);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new StockMonitorRepository(prisma);

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
    const repository = new StockMonitorRepository(prisma);
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
  dailyFxRate: {
    upsert: jest.fn().mockResolvedValue(undefined),
    findUnique: jest.fn(),
  },
});

describe('StockMonitorRepository', () => {
  it('현재 보유 종목을 marketCountry 로 필터한다', async () => {
    const prisma = makePrisma();
    const repository = new StockMonitorRepository(
      prisma as unknown as PrismaService,
    );

    await repository.findCurrentHoldings({ marketCountry: 'US' });

    expect(prisma.holding.findMany).toHaveBeenCalledWith({
      where: { ticker: { marketCountry: 'US' } },
      orderBy: { effectiveDate: 'desc' },
      include: { ticker: true },
    });
  });

  it('일별 환율을 pair 와 rateDate 기준으로 upsert 한다', async () => {
    const prisma = makePrisma();
    const repository = new StockMonitorRepository(
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
    const repository = new StockMonitorRepository(
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
});
