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
