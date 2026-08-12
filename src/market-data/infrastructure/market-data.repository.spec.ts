import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { MarketDataRepository } from './market-data.repository';

describe('MarketDataRepository', () => {
  it('KRX 세부 시장이 분류된 활성 보통주만 유니버스로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { ticker: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    await repository.findUniverseTickers();

    expect(findMany).toHaveBeenCalledWith({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        delistedAt: null,
        tossSymbol: { not: null },
      },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        tossSymbol: true,
        krxMarket: true,
      },
    });
  });

  it('활성 코드가 1,000건 미만이면 상장폐지 갱신을 차단한다', async () => {
    const updateMany = jest.fn();
    const prisma = { ticker: { updateMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const result = await repository.markDelistedExcept(
      Array.from({ length: 999 }, (_, index) => String(index).padStart(6, '0')),
      new Date('2026-08-12T00:00:00.000Z'),
    );

    expect(result).toBe(-1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('직전 활성 2,595건 대비 새 활성 코드가 95% 미만이면 상장폐지를 차단한다', async () => {
    const count = jest.fn().mockResolvedValue(2_595);
    const updateMany = jest.fn();
    const prisma = {
      ticker: { count, updateMany },
    } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const result = await repository.markDelistedExcept(
      Array.from({ length: 2_000 }, (_, index) =>
        String(index).padStart(6, '0'),
      ),
      new Date('2026-08-12T00:00:00.000Z'),
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        delistedAt: null,
      },
    });
    expect(result).toBe(-1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('source가 TOSS여도 KRX 시장이 분류된 행은 상장폐지 처리한다', async () => {
    const count = jest.fn().mockResolvedValue(2_000);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      ticker: { count, updateMany },
    } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);
    const activeCodes = Array.from({ length: 2_000 }, (_, index) =>
      String(index).padStart(6, '0'),
    );
    const asOf = new Date('2026-08-12T00:00:00.000Z');

    await expect(
      repository.markDelistedExcept(activeCodes, asOf),
    ).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        code: { notIn: activeCodes },
        delistedAt: null,
      },
      data: { delistedAt: asOf },
    });
  });

  it('저장 봉 수와 최신 거래일을 한 번의 groupBy로 반환한다', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        tickerId: 3,
        _count: { _all: 4 },
        _max: { tradeDate: new Date('2026-08-11T00:00:00.000Z') },
      },
    ]);
    const prisma = { dailyPrice: { groupBy } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    await expect(repository.findStoredBarStats()).resolves.toEqual(
      new Map([[3, { barCount: 4, latestTradeDate: '2026-08-11' }]]),
    );
    expect(groupBy).toHaveBeenCalledWith({
      by: ['tickerId'],
      _count: { _all: true },
      _max: { tradeDate: true },
    });
  });

  it('증분 일봉을 200건 단위 순차 transaction으로 upsert한다', async () => {
    const upsert = jest.fn((input) => input);
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      dailyPrice: { upsert },
      $transaction: transaction,
    } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);
    const rows = Array.from({ length: 201 }, (_, index) => ({
      tickerId: index + 1,
      tradeDate: new Date('2026-08-11T00:00:00.000Z'),
      close: '100',
      adjClose: '100',
      volume: 1n,
    }));

    const result = await repository.upsertDailyPrices(
      rows,
      new Date('2026-08-12T17:10:00+09:00'),
    );

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction.mock.calls[0][0]).toHaveLength(200);
    expect(transaction.mock.calls[1][0]).toHaveLength(1);
    expect(result).toEqual({ written: 201, blockedIntraday: 0 });
  });

  it('저장 종가를 YYYY-MM-DD 키 문자열 map으로 반환한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        close: { toString: () => '71200' },
      },
    ]);
    const prisma = {
      dailyPrice: { findMany },
    } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const result = await repository.findStoredCloses(3, [
      new Date('2026-08-11T00:00:00.000Z'),
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        tickerId: 3,
        tradeDate: { in: [new Date('2026-08-11T00:00:00.000Z')] },
      },
      select: { tradeDate: true, close: true },
    });
    expect(result).toEqual(new Map([['2026-08-11', '71200']]));
  });
});

describe('MarketDataRepository.findDailySeries', () => {
  it('종목별로 날짜 오름차순 시계열을 돌려준다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-10T00:00:00.000Z'),
        close: new Prisma.Decimal('1000.5'),
        adjClose: new Prisma.Decimal('500.25'),
        volume: BigInt(3_000),
      },
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        close: new Prisma.Decimal('1100'),
        adjClose: new Prisma.Decimal('1100'),
        volume: BigInt(4_000),
      },
      {
        tickerId: 2,
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        close: new Prisma.Decimal('500'),
        adjClose: new Prisma.Decimal('500'),
        volume: BigInt(1_000),
      },
    ]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const series = await repository.findDailySeries([1, 2], 200);

    // 조정가가 원본 종가와 다른 행이 섞여도 두 값이 각자 실린다.
    expect(series.get(1)).toEqual([
      {
        tradeDate: '2026-08-10',
        close: 1000.5,
        adjClose: 500.25,
        volume: 3_000,
      },
      { tradeDate: '2026-08-11', close: 1100, adjClose: 1100, volume: 4_000 },
    ]);
    expect(series.get(2)).toEqual([
      { tradeDate: '2026-08-11', close: 500, adjClose: 500, volume: 1_000 },
    ]);
  });

  it('종목별로 최근 barLimit 개만 남긴다', async () => {
    const findMany = jest.fn().mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        tickerId: 1,
        tradeDate: new Date(`2026-08-0${index + 1}T00:00:00.000Z`),
        close: new Prisma.Decimal(String(100 + index)),
        adjClose: new Prisma.Decimal(String(100 + index)),
        volume: BigInt(1_000),
      })),
    );
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const series = await repository.findDailySeries([1], 2);

    expect(series.get(1)).toEqual([
      { tradeDate: '2026-08-04', close: 103, adjClose: 103, volume: 1_000 },
      { tradeDate: '2026-08-05', close: 104, adjClose: 104, volume: 1_000 },
    ]);
  });

  it('종목이 chunk 크기를 넘으면 나눠 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    await repository.findDailySeries(
      Array.from({ length: 401 }, (_, index) => index + 1),
      200,
    );

    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it('종목이 없으면 조회하지 않는다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const series = await repository.findDailySeries([], 200);

    expect(series.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
