import { PrismaService } from '../../prisma/prisma.service';
import { MarketDataPrismaRepository } from './market-data.prisma.repository';

describe('MarketDataPrismaRepository', () => {
  it('종목 일봉을 7개 컬럼만 읽어 종목별 최근 limit봉을 오름차순으로 반환한다', async () => {
    const aggregate = jest.fn().mockResolvedValue({
      _max: { tradeDate: new Date('2026-08-12T00:00:00.000Z') },
    });
    const findMany = jest.fn().mockResolvedValue([
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-12T00:00:00.000Z'),
        close: { toNumber: () => 121, toString: () => '121' },
        adjClose: { toNumber: () => 120, toString: () => '120' },
        volume: 120n,
      },
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        close: { toNumber: () => 111, toString: () => '111' },
        adjClose: { toNumber: () => 110, toString: () => '110' },
        volume: 110n,
      },
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-10T00:00:00.000Z'),
        close: { toNumber: () => 101, toString: () => '101' },
        adjClose: { toNumber: () => 100, toString: () => '100' },
        volume: 100n,
      },
      {
        tickerId: 2,
        tradeDate: new Date('2026-08-12T00:00:00.000Z'),
        close: { toNumber: () => 221, toString: () => '221' },
        adjClose: { toNumber: () => 220, toString: () => '220' },
        volume: 220n,
      },
    ]);
    const prisma = {
      dailyPrice: { aggregate, findMany },
    } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

    const result = await repository.findBarsForTickers([1, 2], 2);

    expect(aggregate).toHaveBeenCalledWith({
      where: { tickerId: { in: [1, 2] } },
      _max: { tradeDate: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tickerId: { in: [1, 2] },
        tradeDate: { gte: new Date('2025-07-08T00:00:00.000Z') },
      },
      orderBy: [{ tickerId: 'asc' }, { tradeDate: 'desc' }],
      select: {
        tickerId: true,
        tradeDate: true,
        close: true,
        adjClose: true,
        high: true,
        low: true,
        volume: true,
      },
    });
    expect(
      result.get(1)?.map((bar) => bar.tradeDate.toISOString().slice(0, 10)),
    ).toEqual(['2026-08-11', '2026-08-12']);
    expect(result.get(1)?.map((bar) => bar.close.toString())).toEqual([
      '111',
      '121',
    ]);
    expect(result.get(2)).toHaveLength(1);
  });

  it('대상 종목에 저장된 봉이 없으면 일봉 본문을 조회하지 않는다', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _max: { tradeDate: null } });
    const findMany = jest.fn();
    const prisma = {
      dailyPrice: { aggregate, findMany },
    } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

    await expect(repository.findBarsForTickers([1], 200)).resolves.toEqual(
      new Map(),
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('KRX 세부 시장이 분류된 활성 보통주만 유니버스로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { ticker: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

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
    const repository = new MarketDataPrismaRepository(prisma);

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
    const repository = new MarketDataPrismaRepository(prisma);

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
    const repository = new MarketDataPrismaRepository(prisma);
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

  it('저장 봉 수와 최신·최초 거래일을 한 번의 groupBy로 반환한다', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        tickerId: 3,
        _count: { _all: 4 },
        _max: { tradeDate: new Date('2026-08-11T00:00:00.000Z') },
        _min: { tradeDate: new Date('2026-08-06T00:00:00.000Z') },
      },
    ]);
    const prisma = { dailyPrice: { groupBy } } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

    await expect(repository.findStoredBarStats()).resolves.toEqual(
      new Map([
        [
          3,
          {
            barCount: 4,
            latestTradeDate: '2026-08-11',
            oldestTradeDate: '2026-08-06',
          },
        ],
      ]),
    );
    expect(groupBy).toHaveBeenCalledWith({
      by: ['tickerId'],
      _count: { _all: true },
      _max: { tradeDate: true },
      _min: { tradeDate: true },
    });
  });

  it('증분 일봉을 200건 단위 순차 transaction으로 upsert한다', async () => {
    const upsert = jest.fn((input) => input);
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      dailyPrice: { upsert },
      $transaction: transaction,
    } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);
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
    const repository = new MarketDataPrismaRepository(prisma);

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

describe('MarketDataPrismaRepository open 컬럼', () => {
  const settledDate = new Date('2026-08-15T17:10:00+09:00');
  const row = {
    tickerId: 1,
    tradeDate: new Date('2026-08-14T00:00:00.000Z'),
    close: '70000',
    adjClose: '70000',
    volume: 1000n,
  };

  it('insertDailyPrices 가 봉 네 값을 함께 저장한다', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      dailyPrice: { createMany },
    } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

    await repository.insertDailyPrices(
      [{ ...row, open: '69000', high: '71000', low: '68500' }],
      settledDate,
    );

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            open: '69000',
            high: '71000',
            low: '68500',
          }),
        ],
      }),
    );
  });

  it('upsertDailyPrices 가 신규 생성과 갱신 양쪽에 봉 네 값을 싣는다', async () => {
    const upsert = jest.fn((input) => input);
    const prisma = {
      dailyPrice: { upsert },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

    await repository.upsertDailyPrices(
      [{ ...row, open: '69000', high: '71000', low: '68500' }],
      settledDate,
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          open: '69000',
          high: '71000',
          low: '68500',
        }),
        update: expect.objectContaining({
          open: '69000',
          high: '71000',
          low: '68500',
        }),
      }),
    );
  });

  it('공급자가 시가·고가·저가를 빠뜨린 봉은 저장된 값을 null 로 덮지 않는다', async () => {
    const upsert = jest.fn((input) => input);
    const prisma = {
      dailyPrice: { upsert },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

    await repository.upsertDailyPrices([row], settledDate);

    // 키 자체가 있어야 통과하므로 줄을 지우는 회귀도, null 로 되돌리는 회귀도 잡는다.
    const update = upsert.mock.calls[0][0].update;
    expect(update).toHaveProperty('open', undefined);
    expect(update).toHaveProperty('high', undefined);
    expect(update).toHaveProperty('low', undefined);
  });
  describe('applyDelistingHistory', () => {
    const delisting = (
      code: string,
      delistedAt: string,
      reason: string,
    ): {
      code: string;
      name: string;
      market: 'KOSPI';
      delistedAt: Date;
      reason: string;
    } => {
      return {
        code,
        name: `종목${code}`,
        market: 'KOSPI',
        delistedAt: new Date(`${delistedAt}T00:00:00.000Z`),
        reason,
      };
    };

    it('유니버스에 행이 있는 종목만 폐지일과 사유로 갱신한다', async () => {
      const findMany = jest.fn().mockResolvedValue([
        // 목록 차분이 이미 폐지로 찍은 행이다(날짜는 동기화가 돈 날이라 부정확).
        {
          id: 7,
          code: '299900',
          delistedAt: new Date('2026-08-31T00:00:00.000Z'),
          delistingReason: null,
        },
      ]);
      const update = jest.fn().mockReturnValue({ id: 7 });
      const $transaction = jest.fn().mockResolvedValue([{ id: 7 }]);
      const prisma = {
        ticker: { findMany, update },
        $transaction,
      } as unknown as PrismaService;
      const repository = new MarketDataPrismaRepository(prisma);

      const result = await repository.applyDelistingHistory([
        delisting('299900', '2026-08-18', '피흡수합병'),
        // 유니버스에 없는 과거 폐지 종목. 봉이 없어 재생에 쓰이지 못하므로 행을 만들지 않는다.
        delisting('114120', '2024-02-15', '감사의견 거절'),
      ]);

      expect(result).toBe(1);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          market: 'KR',
          krxMarket: { not: null },
          delistedAt: { not: null },
          code: { in: ['299900', '114120'] },
        },
        select: {
          id: true,
          code: true,
          delistedAt: true,
          delistingReason: true,
        },
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          delistedAt: new Date('2026-08-18T00:00:00.000Z'),
          delistingReason: '피흡수합병',
        },
      });
    });

    it('동기화가 돈 날로 찍힌 폐지일을 KIND 의 실제 폐지일로 덮는다', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 7,
          code: '299900',
          // 목록 차분이 8/31 동기화 때 찍은 값. 실제 폐지는 8/18 이다.
          delistedAt: new Date('2026-08-31T00:00:00.000Z'),
          delistingReason: null,
        },
      ]);
      const update = jest.fn().mockReturnValue({ id: 7 });
      const $transaction = jest.fn().mockResolvedValue([{ id: 7 }]);
      const prisma = {
        ticker: { findMany, update },
        $transaction,
      } as unknown as PrismaService;
      const repository = new MarketDataPrismaRepository(prisma);

      await expect(
        repository.applyDelistingHistory([
          delisting('299900', '2026-08-18', '피흡수합병'),
        ]),
      ).resolves.toBe(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          delistedAt: new Date('2026-08-18T00:00:00.000Z'),
          delistingReason: '피흡수합병',
        },
      });
    });

    it('시장 간 중복이 섞여 들어와도 최신 폐지를 고른다', async () => {
      // 목록을 어디서 받았든 `new Map(...)` 은 입력 순서로 덮어쓴다. 옛 이전상장이 뒤에 오면
      // 이미 폐지된 종목에 틀린 날짜·사유가 저장된다.
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 9,
          code: '032390',
          delistedAt: new Date('2026-08-31T00:00:00.000Z'),
          delistingReason: null,
        },
      ]);
      const update = jest.fn().mockReturnValue({ id: 9 });
      const $transaction = jest.fn().mockResolvedValue([{ id: 9 }]);
      const prisma = {
        ticker: { findMany, update },
        $transaction,
      } as unknown as PrismaService;
      const repository = new MarketDataPrismaRepository(prisma);

      await expect(
        repository.applyDelistingHistory([
          delisting('032390', '2009-06-23', '해산 사유 발생'),
          delisting('032390', '2004-04-29', '증권거래소 상장'),
        ]),
      ).resolves.toBe(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          delistedAt: new Date('2009-06-23T00:00:00.000Z'),
          delistingReason: '해산 사유 발생',
        },
      });
    });

    it('상장 중인 종목은 폐지 목록에 있어도 건드리지 않는다', async () => {
      // KIND 코스닥 폐지 목록에는 '유가증권시장 상장'(시장 이전) 이 섞여 있다. 실측 54건.
      // 이 가드가 없으면 셀트리온·키움증권처럼 지금 상장 중인 종목이 폐지 처리된다 —
      // 실제로 그렇게 56건이 유니버스에서 빠졌다.
      const findMany = jest.fn().mockResolvedValue([]);
      const update = jest.fn();
      const $transaction = jest.fn();
      const prisma = {
        ticker: { findMany, update },
        $transaction,
      } as unknown as PrismaService;
      const repository = new MarketDataPrismaRepository(prisma);

      await expect(
        repository.applyDelistingHistory([
          delisting('068270', '2018-02-09', '유가증권시장 상장'),
        ]),
      ).resolves.toBe(0);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ delistedAt: { not: null } }),
        }),
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('이미 같은 값이면 쓰지 않는다', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 7,
          code: '299900',
          delistedAt: new Date('2026-08-18T00:00:00.000Z'),
          delistingReason: '피흡수합병',
        },
      ]);
      const update = jest.fn();
      const $transaction = jest.fn();
      const prisma = {
        ticker: { findMany, update },
        $transaction,
      } as unknown as PrismaService;
      const repository = new MarketDataPrismaRepository(prisma);

      await expect(
        repository.applyDelistingHistory([
          delisting('299900', '2026-08-18', '피흡수합병'),
        ]),
      ).resolves.toBe(0);
      // 매 회차 전량을 받으므로, 이 검사가 없으면 updatedAt 이 매일 갱신돼
      // "언제 실제로 바뀌었나" 를 되짚을 수 없다.
      expect(update).not.toHaveBeenCalled();
      expect($transaction).not.toHaveBeenCalled();
    });
  });
});
