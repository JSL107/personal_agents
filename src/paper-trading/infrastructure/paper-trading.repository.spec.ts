import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradingRepository } from './paper-trading.repository';

describe('PaperTradingRepository pending orders', () => {
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
    paperEquitySnapshot: { findFirst: jest.fn() },
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
  });

  it('한 계좌의 PENDING 주문 묶음을 계좌 잠금 transaction에서 저장한다', async () => {
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
    const repository = new PaperTradingRepository(
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
