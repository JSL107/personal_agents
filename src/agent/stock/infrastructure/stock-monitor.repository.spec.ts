import { PrismaService } from '../../../prisma/prisma.service';
import { StockMonitorRepository } from './stock-monitor.repository';

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
