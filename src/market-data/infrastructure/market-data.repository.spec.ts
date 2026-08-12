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
