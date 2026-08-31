import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradingPrismaRepository } from './paper-trading.prisma.repository';

describe('PaperTradingPrismaRepository pending orders', () => {
  const transaction = {
    paperAccount: { update: jest.fn() },
    paperPosition: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    paperTrade: { findUnique: jest.fn(), create: jest.fn() },
    paperEquitySnapshot: { findFirst: jest.fn() },
    paperOrder: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(),
    paperAccount: { findMany: jest.fn() },
    paperTrade: { findMany: jest.fn() },
    dailyPrice: { findMany: jest.fn() },
    benchmarkDailyClose: { findMany: jest.fn() },
    paperEquitySnapshot: { findFirst: jest.fn(), findMany: jest.fn() },
    paperOrder: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    transaction.paperAccount.update.mockResolvedValue({
      id: 7,
      seedAmount: { toString: () => '10000000' },
      cashBalance: { toString: () => '10000000' },
    });
    transaction.paperPosition.findMany.mockResolvedValue([]);
    transaction.paperEquitySnapshot.findFirst.mockResolvedValue(null);
    transaction.paperOrder.findMany.mockResolvedValue([]);
    transaction.paperOrder.findFirst.mockResolvedValue(null);
    transaction.paperOrder.createMany.mockResolvedValue({ count: 2 });
    transaction.paperOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.paperAccount.findMany.mockResolvedValue([]);
    prisma.paperOrder.findMany.mockResolvedValue([]);
    prisma.paperTrade.findMany.mockResolvedValue([]);
    prisma.dailyPrice.findMany.mockResolvedValue([]);
    prisma.benchmarkDailyClose.findMany.mockResolvedValue([]);
    prisma.paperEquitySnapshot.findMany.mockResolvedValue([]);
  });

  it('추천 채점 데이터는 기간·전략·계좌 경계를 DB에서 제한하고 비백필 스냅샷만 읽는다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const from = new Date('2026-07-01T00:00:00.000Z');
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    prisma.paperAccount.findMany.mockResolvedValue([
      { id: 7, name: 'LONG_TERM', seedAmount: new Prisma.Decimal('10000000') },
      { id: 8, name: 'SWING', seedAmount: new Prisma.Decimal('10000000') },
    ]);
    prisma.paperOrder.findMany.mockResolvedValue([
      {
        id: 301,
        accountId: 7,
        tickerId: 71,
        side: 'BUY',
        strategy: 'LONG_TERM',
        status: 'FILLED',
        quantity: new Prisma.Decimal('9'),
      },
    ]);
    prisma.paperTrade.findMany
      .mockResolvedValueOnce([
        {
          id: 501,
          orderId: 301,
          accountId: 7,
          tickerId: 71,
          side: 'BUY',
          quantity: new Prisma.Decimal('9'),
          price: new Prisma.Decimal('10000'),
          fee: new Prisma.Decimal('10'),
          tax: new Prisma.Decimal('0'),
          realizedPnl: null,
          tradeDate: new Date('2026-07-02T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await repository.loadRecommendationScoreData({ from, asOf });

    expect(prisma.paperAccount.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['LONG_TERM', 'SWING'] } },
      select: { id: true, name: true, seedAmount: true },
      orderBy: { id: 'asc' },
    });
    expect(prisma.paperOrder.findMany).toHaveBeenCalledWith({
      where: {
        accountId: { in: [7, 8] },
        side: 'BUY',
        strategy: { in: ['LONG_TERM', 'SWING'] },
        decidedAt: { gte: from, lte: asOf },
      },
      select: {
        id: true,
        accountId: true,
        tickerId: true,
        side: true,
        strategy: true,
        status: true,
        quantity: true,
        ruleVersion: true,
      },
      orderBy: { id: 'asc' },
    });
    expect(prisma.paperTrade.findMany).toHaveBeenNthCalledWith(1, {
      where: { orderId: { in: [301] }, side: 'BUY', tradeDate: { lte: asOf } },
      select: {
        id: true,
        orderId: true,
        accountId: true,
        tickerId: true,
        side: true,
        quantity: true,
        price: true,
        fee: true,
        tax: true,
        realizedPnl: true,
        tradeDate: true,
      },
      orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.dailyPrice.findMany).toHaveBeenCalledWith({
      where: {
        tickerId: { in: [71] },
        tradeDate: {
          gte: new Date('2026-07-02T00:00:00.000Z'),
          lte: asOf,
        },
      },
      select: {
        tickerId: true,
        tradeDate: true,
        close: true,
        ticker: { select: { krxMarket: true } },
      },
      orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.benchmarkDailyClose.findMany).toHaveBeenCalledWith({
      where: {
        symbol: 'KOSPI',
        tradeDate: {
          gte: new Date('2026-07-02T00:00:00.000Z'),
          lte: asOf,
        },
      },
      select: { tradeDate: true, close: true },
      orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.paperEquitySnapshot.findMany).toHaveBeenCalledWith({
      where: {
        accountId: { in: [7, 8] },
        tradeDate: { gte: from, lte: asOf },
        isBackfilled: false,
      },
      select: {
        accountId: true,
        tradeDate: true,
        totalValue: true,
        isBackfilled: true,
      },
      orderBy: [{ accountId: 'asc' }, { tradeDate: 'asc' }, { id: 'asc' }],
    });
  });

  it('전체 이력 조회는 PaperOrder.decidedAt 하한과 포트폴리오 기간 하한을 생략한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    prisma.paperAccount.findMany.mockResolvedValue([
      { id: 7, name: 'LONG_TERM', seedAmount: new Prisma.Decimal('10000000') },
    ]);

    await repository.loadRecommendationScoreData({ asOf });

    expect(prisma.paperOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ decidedAt: { lte: asOf } }),
      }),
    );
    expect(prisma.paperEquitySnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tradeDate: { lte: asOf } }),
      }),
    );
  });

  it('한 계좌의 PENDING 주문 묶음을 계좌 잠금 transaction에서 저장한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const decidedAt = new Date('2026-08-13T07:00:00.000Z');

    const result = await repository.saveRecommendationAtomically({
      accountId: 7,
      strategy: 'LONG_TERM',
      decidedAt,
      decide: (state) => ({
        result: { count: 2, cash: state.account.cashBalance.toString() },
        orders: [
          {
            tickerId: 71,
            side: 'BUY',
            quantity: '200',
            strategy: 'LONG_TERM',
            reason: '추세 우위',
            decidedAt,
            dataAsOf: new Date('2026-08-13T00:00:00.000Z'),
            targetTradeDate: new Date('2026-08-14T00:00:00.000Z'),
            status: 'PENDING',
            indicatorSnapshot: { close: 10_000 },
            ruleVersion: 2,
            agentRunId: 99,
          },
          {
            tickerId: 72,
            side: 'SELL',
            quantity: '10',
            strategy: 'LONG_TERM',
            reason: '추세 이탈',
            decidedAt,
            dataAsOf: new Date('2026-08-13T00:00:00.000Z'),
            targetTradeDate: new Date('2026-08-14T00:00:00.000Z'),
            status: 'PENDING',
            indicatorSnapshot: null,
            ruleVersion: null,
            agentRunId: 99,
          },
        ],
      }),
    });

    expect(result).toEqual({ count: 2, cash: expect.any(String) });
    expect(transaction.paperAccount.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { cashBalance: { increment: 0 } },
      select: { id: true, seedAmount: true, cashBalance: true },
    });
    expect(transaction.paperOrder.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          accountId: 7,
          tickerId: 71,
          status: 'PENDING',
          agentRunId: 99,
          indicatorSnapshot: { close: 10_000 },
        }),
        expect.objectContaining({
          accountId: 7,
          tickerId: 72,
          indicatorSnapshot: Prisma.JsonNull,
        }),
      ]),
    });
  });

  it('주문이 없으면 transaction을 열지 않는다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.saveRecommendationAtomically({
        accountId: 7,
        strategy: 'LONG_TERM',
        decidedAt: new Date('2026-08-13T07:00:00.000Z'),
        decide: () => ({ result: { count: 0 }, orders: [] }),
      }),
    ).resolves.toEqual({ count: 0 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.paperOrder.createMany).not.toHaveBeenCalled();
  });

  it('최신 평가액을 거래일 내림차순으로 조회한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    prisma.paperEquitySnapshot.findFirst.mockResolvedValue(null);

    await repository.findLatestValuation(7);

    expect(prisma.paperEquitySnapshot.findFirst).toHaveBeenCalledWith({
      where: { accountId: 7 },
      orderBy: { tradeDate: 'desc' },
      select: {
        id: true,
        tradeDate: true,
        totalValue: true,
        returnRate: true,
      },
    });
  });

  it('같은 strategy와 decidedAt 주문이 하나라도 있으면 callback과 저장을 차단한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    transaction.paperOrder.findFirst.mockResolvedValue({ id: 300 });
    const decide = jest.fn();

    await expect(
      repository.saveRecommendationAtomically({
        accountId: 7,
        strategy: 'LONG_TERM',
        decidedAt: new Date('2026-08-13T07:00:00.000Z'),
        decide,
      }),
    ).rejects.toThrow('이미 저장된 모의투자 추천');

    expect(transaction.paperOrder.findFirst).toHaveBeenCalledWith({
      where: {
        accountId: 7,
        strategy: 'LONG_TERM',
        decidedAt: new Date('2026-08-13T07:00:00.000Z'),
      },
      select: { id: true },
    });
    expect(decide).not.toHaveBeenCalled();
    expect(transaction.paperOrder.createMany).not.toHaveBeenCalled();
  });

  it('locked callback에 최신 account, positions, valuation, pending orders를 전달한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    transaction.paperPosition.findMany.mockResolvedValue([]);
    transaction.paperEquitySnapshot.findFirst.mockResolvedValue({ id: 9 });
    transaction.paperOrder.findMany.mockResolvedValue([{ id: 10 }]);
    const decide = jest
      .fn()
      .mockReturnValue({ result: { count: 0 }, orders: [] });

    await repository.saveRecommendationAtomically({
      accountId: 7,
      strategy: 'LONG_TERM',
      decidedAt: new Date('2026-08-13T07:00:00.000Z'),
      decide,
    });

    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ id: 7 }),
        positions: [],
        latestValuation: { id: 9 },
        existingOrders: [{ id: 10 }],
      }),
    );
  });

  it('recommendation identity 조회는 주문 status와 무관하게 검사한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    prisma.paperOrder.findFirst.mockResolvedValue({ id: 1 });
    const identity = {
      accountId: 7,
      strategy: 'SWING' as const,
      decidedAt: new Date('2026-08-13T07:00:00.000Z'),
    };

    await expect(repository.hasOrdersForRecommendation(identity)).resolves.toBe(
      true,
    );

    expect(prisma.paperOrder.findFirst).toHaveBeenCalledWith({
      where: identity,
      select: { id: true },
    });
  });

  it('오늘까지 도래한 PENDING 주문을 id 순서와 종목 시세 identity로 조회한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const tradeDate = new Date('2026-08-13T00:00:00.000Z');
    prisma.paperOrder.findMany.mockResolvedValue([
      {
        id: 301,
        accountId: 7,
        account: { name: 'PAPER_LONG_TERM' },
        tickerId: 71,
        ticker: {
          code: '005930',
          name: '삼성전자',
          tossSymbol: '005930',
          krxMarket: 'KOSPI',
        },
        side: 'BUY',
        quantity: new Prisma.Decimal('9'),
        strategy: 'LONG_TERM',
        reason: '추세 우위',
        targetTradeDate: tradeDate,
      },
    ]);

    await expect(repository.findDuePendingOrders(tradeDate)).resolves.toEqual([
      expect.objectContaining({
        id: 301,
        accountName: 'PAPER_LONG_TERM',
        tossSymbol: '005930',
        krxMarket: 'KOSPI',
      }),
    ]);
    expect(prisma.paperOrder.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        targetTradeDate: { lte: tradeDate },
      },
      include: { account: true, ticker: true },
      orderBy: { id: 'asc' },
    });
  });

  it('개별 만료와 장 마감 일괄 만료는 PENDING 주문에만 compare-and-set한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const tradeDate = new Date('2026-08-13T00:00:00.000Z');
    prisma.paperOrder.count.mockResolvedValue(4);
    prisma.paperOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 3 });

    await expect(
      repository.expirePendingOrder(301, '당일 봉 없음'),
    ).resolves.toBe(true);
    await expect(
      repository.expireDuePendingOrders(tradeDate, '체결가 조회 실패'),
    ).resolves.toEqual({ attempted: 4, expired: 3 });
    expect(prisma.paperOrder.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 301, status: 'PENDING' },
      data: { status: 'EXPIRED', statusReason: '당일 봉 없음' },
    });
    expect(prisma.paperOrder.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'PENDING',
        targetTradeDate: { lte: tradeDate },
      },
      data: { status: 'EXPIRED', statusReason: '체결가 조회 실패' },
    });
    expect(prisma.paperOrder.count).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        targetTradeDate: { lte: tradeDate },
      },
    });
  });

  it('자동 체결은 PENDING compare-and-set 뒤 거래·포지션·계좌를 같은 transaction에서 갱신한다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    transaction.paperOrder.findUnique.mockResolvedValue({
      status: 'PENDING',
      accountId: 7,
      tickerId: 71,
      side: 'BUY',
      strategy: 'LONG_TERM',
    });
    transaction.paperPosition.findUnique.mockResolvedValue(null);
    transaction.paperTrade.findUnique.mockResolvedValue(null);
    transaction.paperTrade.create.mockResolvedValue({ id: 501 });

    await repository.fillPendingOrderAtomically({
      orderId: 301,
      accountId: 7,
      tickerId: 71,
      side: 'BUY',
      strategy: 'LONG_TERM',
      price: '10000',
      tradeDate: new Date('2026-08-13T00:00:00.000Z'),
      decide: () => ({
        status: 'FILLED',
        quantity: '9',
        fee: '16',
        tax: '0',
        realizedPnl: null,
        cashBalance: '909984',
        positionQuantity: '9',
        positionAvgPrice: '10001.7777777777777778',
      }),
    });

    expect(transaction.paperOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 301, status: 'PENDING' },
      data: { quantity: '9', status: 'FILLED', statusReason: null },
    });
    expect(transaction.paperTrade.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 301,
        quantity: '9',
        price: '10000',
        fingerprint: '7:71:2026-08-13:BUY:9:10000:301',
      }),
    });
    expect(transaction.paperPosition.upsert).toHaveBeenCalledTimes(1);
    expect(transaction.paperAccount.update).toHaveBeenCalledTimes(2);
  });

  it('자동 체결 compare-and-set이 경합에서 지면 장부를 쓰지 않는다', async () => {
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    transaction.paperOrder.findUnique.mockResolvedValue({
      status: 'PENDING',
      accountId: 7,
      tickerId: 71,
      side: 'BUY',
      strategy: 'LONG_TERM',
    });
    transaction.paperPosition.findUnique.mockResolvedValue(null);
    transaction.paperOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.fillPendingOrderAtomically({
        orderId: 301,
        accountId: 7,
        tickerId: 71,
        side: 'BUY',
        strategy: 'LONG_TERM',
        price: '10000',
        tradeDate: new Date('2026-08-13T00:00:00.000Z'),
        decide: () => ({
          status: 'FILLED',
          quantity: '9',
          fee: '16',
          tax: '0',
          realizedPnl: null,
          cashBalance: '909984',
          positionQuantity: '9',
          positionAvgPrice: '10001.7777777777777778',
        }),
      }),
    ).resolves.toEqual({ status: 'ALREADY_PROCESSED' });
    expect(transaction.paperTrade.create).not.toHaveBeenCalled();
    expect(transaction.paperPosition.upsert).not.toHaveBeenCalled();
    expect(transaction.paperAccount.update).toHaveBeenCalledTimes(1);
  });
});

describe('PaperTradingPrismaRepository 보유 종목 조회 조건', () => {
  // 추천이 고르는 유니버스 종목은 KRX 상장법인 목록에서 오므로 source 가 'KRX' 다.
  // 조회에 source='TOSS' 를 걸면 그 보유가 통째로 빠져 "보유 없음" 으로 읽히고,
  // 원장(필터 없이 전량 조회)과 대조하는 불변식이 매일 깨져 스냅샷이 적재되지 않는다.
  const krxPosition = {
    id: 11,
    accountId: 7,
    tickerId: 1976,
    quantity: new Prisma.Decimal('293'),
    avgPrice: new Prisma.Decimal('6821.2696'),
    ticker: {
      code: '121440',
      name: '한국종목',
      tossSymbol: '121440',
      source: 'KRX',
    },
  };

  it('findPositionsWithTicker 는 source 를 조건에 넣지 않고 KRX 출처 보유도 반환한다', async () => {
    const prisma = { paperPosition: { findMany: jest.fn() } };
    prisma.paperPosition.findMany.mockResolvedValue([krxPosition]);
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const positions = await repository.findPositionsWithTicker(7);

    expect(positions).toHaveLength(1);
    expect(positions[0].tickerId).toBe(1976);
    const where = prisma.paperPosition.findMany.mock.calls[0][0].where;
    expect(where.ticker).toEqual({
      market: 'KR',
      marketCountry: 'KR',
      tossSymbol: { not: null },
    });
    expect(where.ticker.source).toBeUndefined();
  });

  it('스냅샷 재검증 조회도 같은 조건이라 평가 대상과 불변식 대상이 갈리지 않는다', async () => {
    const transaction = {
      paperAccount: {
        update: jest.fn().mockResolvedValue({
          id: 7,
          seedAmount: new Prisma.Decimal('10000000'),
          cashBalance: new Prisma.Decimal('4054273'),
        }),
      },
      paperPosition: { findMany: jest.fn().mockResolvedValue([krxPosition]) },
      paperTrade: { findMany: jest.fn().mockResolvedValue([]) },
      paperCorporateAction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(transaction)),
    };
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );
    const decide = jest.fn().mockReturnValue({ snapshot: null, result: 'ok' });

    await expect(
      repository.saveEquitySnapshotWithRevalidatedState(7, decide),
    ).resolves.toBe('ok');

    const where = transaction.paperPosition.findMany.mock.calls[0][0].where;
    expect(where.ticker).toEqual({
      market: 'KR',
      marketCountry: 'KR',
      tossSymbol: { not: null },
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        positions: [expect.objectContaining({ tickerId: 1976 })],
      }),
    );
  });
});

describe('PaperTradingPrismaRepository 밴드 청산 주문', () => {
  const transaction = {
    paperAccount: { update: jest.fn() },
    paperPosition: { findMany: jest.fn() },
    paperOrder: { findMany: jest.fn(), createMany: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const repository = new PaperTradingPrismaRepository(
    prisma as unknown as PrismaService,
  );
  const input = {
    accountId: 5,
    strategy: 'LONG_TERM' as const,
    decidedAt: new Date('2026-08-18T08:40:00.000Z'),
    dataAsOf: new Date('2026-08-18T00:00:00.000Z'),
    targetTradeDate: new Date('2026-08-19T00:00:00.000Z'),
    agentRunId: null,
    threshold: { takeProfitPercent: 10, stopLossPercent: -5 },
    orders: [
      { tickerId: 1976, reason: '익절 밴드 도달' },
      { tickerId: 178, reason: '손절 밴드 이탈' },
    ],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    transaction.paperAccount.update.mockResolvedValue({ id: 5 });
    transaction.paperOrder.findMany.mockResolvedValue([]);
    transaction.paperOrder.createMany.mockResolvedValue({ count: 2 });
    transaction.paperPosition.findMany.mockResolvedValue([
      { tickerId: 1976, quantity: new Prisma.Decimal('293') },
      { tickerId: 178, quantity: new Prisma.Decimal('183') },
    ]);
  });

  // 판정 시점의 수량을 그대로 쓰면 그 사이 일부 체결이 끼어들었을 때 보유보다 많은
  // 수량을 팔려다 체결 단계에서 통째로 실패한다.
  it('수량을 원장의 현재 보유로 다시 맞춰 저장한다', async () => {
    await expect(repository.createExitBandOrders(input)).resolves.toEqual({
      created: 2,
      createdTickerIds: [1976, 178],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
    });

    const data = transaction.paperOrder.createMany.mock.calls[0][0].data;
    expect(data).toEqual([
      expect.objectContaining({
        tickerId: 1976,
        quantity: '293',
        side: 'SELL',
      }),
      expect.objectContaining({ tickerId: 178, quantity: '183', side: 'SELL' }),
    ]);
    expect(transaction.paperAccount.update).toHaveBeenCalledTimes(1);
  });

  // 이 회차가 어느 밴드로 팔았는지가 주문에 남지 않으면, 값을 바꾼 뒤의 성적이 이전 값의
  // 성적과 한 표본에 섞여 "밴드를 넓혀서 나아졌나" 를 영영 가릴 수 없다.
  it('그 회차의 밴드 설정을 주문마다 적는다', async () => {
    await repository.createExitBandOrders(input);

    const data = transaction.paperOrder.createMany.mock.calls[0][0].data;
    expect(data).toEqual([
      expect.objectContaining({
        exitTakeProfitPercent: 10,
        exitStopLossPercent: -5,
      }),
      expect.objectContaining({
        exitTakeProfitPercent: 10,
        exitStopLossPercent: -5,
      }),
    ]);
  });

  it('이미 대기 중인 매도가 있는 종목은 중복으로 걸지 않는다', async () => {
    transaction.paperOrder.findMany.mockResolvedValue([{ tickerId: 1976 }]);

    await expect(repository.createExitBandOrders(input)).resolves.toEqual({
      created: 1,
      createdTickerIds: [178],
      skippedByPendingSell: 1,
      skippedByNoPosition: 0,
    });

    const data = transaction.paperOrder.createMany.mock.calls[0][0].data;
    expect(data).toEqual([expect.objectContaining({ tickerId: 178 })]);
  });

  it('보유가 사라진 종목은 주문을 만들지 않는다', async () => {
    transaction.paperPosition.findMany.mockResolvedValue([]);

    await expect(repository.createExitBandOrders(input)).resolves.toEqual({
      created: 0,
      createdTickerIds: [],
      skippedByPendingSell: 0,
      skippedByNoPosition: 2,
    });
    expect(transaction.paperOrder.createMany).not.toHaveBeenCalled();
  });

  it('판정 결과가 없으면 transaction 자체를 열지 않는다', async () => {
    await expect(
      repository.createExitBandOrders({ ...input, orders: [] }),
    ).resolves.toEqual({
      created: 0,
      createdTickerIds: [],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// 구간 행은 실행마다 개수가 달라진다. upsert 만 하면 사라진 구간이 유령으로 남아 밴드별 판정에
// 섞이므로, 같은 트랜잭션에서 먼저 지우고 다시 넣는지 순서까지 본다.
describe('PaperTradingPrismaRepository 추천 채점 저장', () => {
  const prisma = {
    $transaction: jest.fn(),
    recommendationScore: { upsert: jest.fn() },
    recommendationScorePeriod: { deleteMany: jest.fn(), upsert: jest.fn() },
  };
  const repository = new PaperTradingPrismaRepository(
    prisma as unknown as PrismaService,
  );
  const asOf = new Date('2026-08-24T00:00:00.000Z');
  const cumulative = {
    accountId: 7,
    strategy: 'LONG_TERM',
    asOf,
    ruleVersions: [2],
    unknownRuleVersionCount: 0,
    exitBands: ['+2/-0.2'],
    bandlessSellCount: 0,
    recommendationCount: 1,
    closedCount: 1,
    openCount: 0,
    expiredCount: 0,
    hitCount: 1,
    hitRate: '1',
    meanReturnRate: '0.1',
    medianReturnRate: '0.1',
    maximumLoss: null,
    averageHoldingDays: '1',
    meanExcessReturnRate: null,
    meanShadowReturnRate: null,
    snapshotCount: 1,
    accountReturnRate: '0.1',
    maximumDrawdown: null,
    turnoverRate: '1',
    cumulativeCost: '0',
    exclusions: {},
  };
  const periodInput = {
    accountId: 7,
    asOf,
    periodLabel: '+2/-0.2',
    strategy: 'LONG_TERM',
    closedCount: 1,
    hitCount: 1,
    hitRate: '1',
    meanReturnRate: '0.1',
    medianReturnRate: '0.1',
    maximumLoss: null,
    averageHoldingDays: '1',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.recommendationScorePeriod.deleteMany.mockReturnValue('DELETE');
    prisma.recommendationScore.upsert.mockReturnValue('SCORE_UPSERT');
    prisma.recommendationScorePeriod.upsert.mockReturnValue('PERIOD_UPSERT');
  });

  it('구간을 먼저 지운 뒤 누적과 구간을 한 트랜잭션에서 쓴다', async () => {
    await repository.saveRecommendationScores(
      [cumulative as never],
      [periodInput as never],
    );

    // 삭제가 반드시 앞이다. 뒤면 방금 쓴 구간을 지운다.
    expect(prisma.$transaction).toHaveBeenCalledWith([
      'DELETE',
      'SCORE_UPSERT',
      'PERIOD_UPSERT',
    ]);
    expect(prisma.recommendationScorePeriod.deleteMany).toHaveBeenCalledWith({
      where: { accountId: 7, asOf },
    });
  });

  it('이번 회차의 구간이 0개인 계좌도 옛 구간을 지운다', async () => {
    await repository.saveRecommendationScores([cumulative as never], []);

    expect(prisma.$transaction).toHaveBeenCalledWith([
      'DELETE',
      'SCORE_UPSERT',
    ]);
    expect(prisma.recommendationScorePeriod.deleteMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('저장할 것이 아무것도 없으면 트랜잭션을 열지 않는다', async () => {
    await repository.saveRecommendationScores([], []);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PaperTradingPrismaRepository 기업행동·결제일', () => {
  it('기업행동은 계좌 잠금·포지션 조회 뒤 원장과 잔액을 한 transaction에 반영한다', async () => {
    const accountUpdate = jest.fn().mockResolvedValue({
      id: 5,
      seedAmount: new Prisma.Decimal('10000000'),
      cashBalance: new Prisma.Decimal('775952'),
    });
    const positionFindUnique = jest.fn().mockResolvedValue({
      id: 71,
      accountId: 5,
      tickerId: 178,
      quantity: new Prisma.Decimal('743'),
      avgPrice: new Prisma.Decimal('2335'),
    });
    const corporateActionCreate = jest.fn().mockResolvedValue({ id: 41 });
    const transaction = {
      paperAccount: { update: accountUpdate },
      paperPosition: {
        findUnique: positionFindUnique,
        upsert: jest.fn(),
      },
      paperCorporateAction: { create: corporateActionCreate },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(transaction)),
    };
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.applyCorporateActionAtomically({
      accountId: 5,
      tickerId: 178,
      kind: 'DIVIDEND',
      exDate: new Date('2026-08-28T00:00:00.000Z'),
      perShareAmount: '8640',
      decide: ({ account }) => ({
        cashBalance: account.cashBalance.plus('1330319').toString(),
        cashDelta: '1330319',
        quantityDelta: '0',
        avgPriceAfter: null,
        eligibleQuantity: '182',
        grossAmount: '1572480',
        taxAmount: '242161',
      }),
    });

    expect(result).toEqual({
      corporateActionId: 41,
      cashBalance: '2106271',
      cashDelta: '1330319',
      quantityDelta: '0',
      avgPriceAfter: null,
      eligibleQuantity: '182',
      grossAmount: '1572480',
      taxAmount: '242161',
    });
    expect(accountUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      positionFindUnique.mock.invocationCallOrder[0],
    );
    expect(positionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId_tickerId: { accountId: 5, tickerId: 178 } },
      }),
    );
    expect(corporateActionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fingerprint: '5:178:2026-08-28:DIVIDEND:8640:0',
          cashDelta: '1330319',
        }),
      }),
    );
    expect(accountUpdate).toHaveBeenCalledTimes(2);
    expect(accountUpdate).toHaveBeenLastCalledWith({
      where: { id: 5 },
      data: { cashBalance: '2106271' },
    });
  });

  it('기업행동 fingerprint 유니크 오류를 한국어 중복 메시지로 변환한다', async () => {
    const transaction = {
      paperAccount: {
        update: jest.fn().mockResolvedValue({
          id: 5,
          seedAmount: new Prisma.Decimal('1000'),
          cashBalance: new Prisma.Decimal('1000'),
        }),
      },
      paperPosition: { findUnique: jest.fn().mockResolvedValue(null) },
      paperCorporateAction: {
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(transaction)),
    };
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.applyCorporateActionAtomically({
        accountId: 5,
        tickerId: 178,
        kind: 'DIVIDEND',
        exDate: new Date('2026-08-28T00:00:00.000Z'),
        perShareAmount: '8640',
        decide: () => ({
          cashBalance: '1000',
          cashDelta: '0',
          quantityDelta: '0',
          avgPriceAfter: null,
          eligibleQuantity: '1',
          grossAmount: '1',
          taxAmount: '0',
        }),
      }),
    ).rejects.toThrow('이미 기록된 기업행동입니다');
  });

  it('기준일 전 거래·기업행동의 수량을 합산한다', async () => {
    const prisma = {
      paperTrade: {
        findMany: jest.fn().mockResolvedValue([
          { side: 'BUY', quantity: new Prisma.Decimal('10') },
          { side: 'SELL', quantity: new Prisma.Decimal('3') },
        ]),
      },
      paperCorporateAction: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ quantityDelta: new Prisma.Decimal('2') }]),
      },
    };
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.findQuantityAtDate(
        5,
        178,
        new Date('2026-08-28T00:00:00.000Z'),
      ),
    ).resolves.toEqual(new Prisma.Decimal('9'));
  });

  it('결제일이 없는 거래만 체결일 기준 결제일로 백필한다', async () => {
    const update = jest.fn();
    const prisma = {
      paperTrade: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 71, tradeDate: new Date('2026-08-14T00:00:00.000Z') },
          ]),
        update,
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const repository = new PaperTradingPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await expect(repository.backfillSettlementDates()).resolves.toEqual({
      updated: 1,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 71 },
      data: { settlementDate: new Date('2026-08-18T00:00:00.000Z') },
    });
  });
});
