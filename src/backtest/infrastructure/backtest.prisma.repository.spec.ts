import { PrismaService } from '../../prisma/prisma.service';
import { BacktestPrismaRepository } from './backtest.prisma.repository';

describe('BacktestPrismaRepository', () => {
  it('구간 안의 봉만 종목별로 오름차순 정렬해 돌려준다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-13T00:00:00.000Z'),
        open: { toString: () => '69000' },
        close: { toString: () => '70000', toNumber: () => 70000 },
        adjClose: { toString: () => '70000', toNumber: () => 70000 },
        volume: 1000n,
      },
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-14T00:00:00.000Z'),
        open: null,
        close: { toString: () => '71000', toNumber: () => 71000 },
        adjClose: { toString: () => '71000', toNumber: () => 71000 },
        volume: 1200n,
      },
    ]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new BacktestPrismaRepository(prisma);

    const bars = await repository.findBarsInRange(
      [1],
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-08-14T00:00:00.000Z'),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ tickerId: 'asc' }, { tradeDate: 'asc' }],
      }),
    );
    expect(bars.get(1)).toHaveLength(2);
    expect(bars.get(1)![0].open).toBe(69000);
    expect(bars.get(1)![1].open).toBeNull();
  });

  // 시작일 기준으로 좁히지 않으면 구간 안에 폐지된 종목이 살아 있던 날까지 사라져
  // 재생이 "끝까지 살아남은 종목" 만 보게 된다 — 생존 편향이 정확히 여기서 들어온다.
  it('유니버스는 재생 시작일에 살아 있던 종목까지 본다', async () => {
    const delistedAt = new Date('2026-05-20T00:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 7,
        code: '005930',
        name: '삼성전자',
        krxMarket: 'KOSPI',
        delistedAt: null,
      },
      {
        id: 8,
        code: '299900',
        name: '중간폐지',
        krxMarket: 'KOSDAQ',
        delistedAt,
      },
    ]);
    const prisma = { ticker: { findMany } } as unknown as PrismaService;
    const repository = new BacktestPrismaRepository(prisma);
    const from = new Date('2026-01-02T00:00:00.000Z');

    const tickers = await repository.findUniverse(from);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          market: 'KR',
          krxMarket: { not: null },
          OR: [{ delistedAt: null }, { delistedAt: { gt: from } }],
        }),
      }),
    );
    expect(tickers).toEqual([
      {
        tickerId: 7,
        code: '005930',
        name: '삼성전자',
        krxMarket: 'KOSPI',
        delistedAt: null,
      },
      {
        tickerId: 8,
        code: '299900',
        name: '중간폐지',
        krxMarket: 'KOSDAQ',
        delistedAt,
      },
    ]);
  });

  it('벤치마크는 구간 안의 KOSPI 종가만 오름차순으로 돌려준다', async () => {
    const close = { toString: () => '2500.1234', toNumber: () => 2500.1234 };
    const findMany = jest.fn().mockResolvedValue([
      {
        tradeDate: new Date('2026-08-13T00:00:00.000Z'),
        close,
      },
    ]);
    const prisma = {
      benchmarkDailyClose: { findMany },
    } as unknown as PrismaService;
    const repository = new BacktestPrismaRepository(prisma);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-08-14T00:00:00.000Z');

    const closes = await repository.findBenchmarkCloses(from, to);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol: 'KOSPI', tradeDate: { gte: from, lte: to } },
        orderBy: { tradeDate: 'asc' },
      }),
    );
    expect(closes).toEqual([
      { tradeDate: new Date('2026-08-13T00:00:00.000Z'), close },
    ]);
  });
});
