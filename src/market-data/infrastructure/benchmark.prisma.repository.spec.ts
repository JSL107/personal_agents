import { PrismaService } from '../../prisma/prisma.service';
import { DecimalValue } from '../domain/market-data.type';
import { BenchmarkPrismaRepository } from './benchmark.prisma.repository';

describe('BenchmarkPrismaRepository', () => {
  it('심볼별 최신 거래일을 반환한다', async () => {
    const tradeDate = new Date('2026-08-11T00:00:00.000Z');
    const findFirst = jest.fn().mockResolvedValue({ tradeDate });
    const prisma = {
      benchmarkDailyClose: { findFirst },
    } as unknown as PrismaService;
    const repository = new BenchmarkPrismaRepository(prisma);

    await expect(repository.findLatestTradeDate('KOSPI')).resolves.toEqual(
      tradeDate,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { symbol: 'KOSPI' },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
  });

  it('저장된 거래일이 없으면 null을 반환한다', async () => {
    const prisma = {
      benchmarkDailyClose: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const repository = new BenchmarkPrismaRepository(prisma);

    await expect(repository.findLatestTradeDate('KOSPI')).resolves.toBeNull();
  });

  it('심볼과 거래일 기준으로 종가를 upsert하고 수집 시각을 갱신한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T08:10:00.000Z'));
    const upsert = jest.fn((input) => input);
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      benchmarkDailyClose: { upsert },
      $transaction: transaction,
    } as unknown as PrismaService;
    const repository = new BenchmarkPrismaRepository(prisma);
    const tradeDate = new Date('2026-08-11T00:00:00.000Z');
    const close: DecimalValue = {
      toNumber: () => 3210.24,
      toString: () => '3210.24',
    };

    try {
      await expect(
        repository.upsertCloses([{ symbol: 'KOSPI', tradeDate, close }]),
      ).resolves.toBe(1);
      expect(upsert).toHaveBeenCalledWith({
        where: {
          symbol_tradeDate: { symbol: 'KOSPI', tradeDate },
        },
        create: { symbol: 'KOSPI', tradeDate, close: '3210.24' },
        update: {
          close: '3210.24',
          fetchedAt: new Date('2026-08-12T08:10:00.000Z'),
        },
      });
      expect(transaction).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('저장할 행이 없으면 transaction을 열지 않고 0을 반환한다', async () => {
    const transaction = jest.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const repository = new BenchmarkPrismaRepository(prisma);

    await expect(repository.upsertCloses([])).resolves.toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});
