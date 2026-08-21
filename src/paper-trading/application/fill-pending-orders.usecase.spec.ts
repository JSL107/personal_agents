import { Prisma } from '@prisma/client';

import { MarketDataPort } from '../../market-data/domain/port/market-data.port';
import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { ExecutePaperOrderUsecase } from './execute-paper-order.usecase';
import { FillPendingOrdersUsecase } from './fill-pending-orders.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

const dueOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  accountId: 11,
  accountName: 'PAPER_LONG_TERM',
  tickerId: 21,
  tickerCode: '005930',
  tickerName: '삼성전자',
  tossSymbol: '005930',
  krxMarket: 'KOSPI',
  side: 'BUY' as const,
  quantity: decimal('10'),
  strategy: 'LONG_TERM' as const,
  reason: '추세 우위',
  targetTradeDate: new Date('2026-08-13T00:00:00.000Z'),
  ...overrides,
});

const createFixture = () => {
  const repository = {
    findDuePendingOrders: jest.fn().mockResolvedValue([dueOrder()]),
    expireDuePendingOrders: jest
      .fn()
      .mockResolvedValue({ attempted: 0, expired: 0 }),
    expirePendingOrder: jest.fn().mockResolvedValue(true),
  };
  const marketData: Pick<MarketDataPort, 'fetchDailyBars'> = {
    fetchDailyBars: jest.fn().mockResolvedValue([
      {
        tradeDate: new Date('2026-08-13T00:00:00.000Z'),
        open: decimal('70000'),
        close: decimal('71000'),
        adjClose: decimal('71000'),
        volume: 1n,
        currency: 'KRW',
      },
    ]),
  };
  const executeOrder = {
    execute: jest.fn().mockResolvedValue({ status: 'FILLED', quantity: '10' }),
  };
  const usecase = new FillPendingOrdersUsecase(
    repository as unknown as PaperTradingPrismaRepository,
    marketData as MarketDataPort,
    executeOrder as unknown as ExecutePaperOrderUsecase,
  );
  return { usecase, repository, marketData, executeOrder };
};

describe('FillPendingOrdersUsecase', () => {
  it('KST 09:30 전에는 주문을 조회하지 않고 창 밖 skip을 반환한다', async () => {
    const { usecase, repository, marketData } = createFixture();

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T00:29:59.000Z') }),
    ).resolves.toMatchObject({
      window: 'BEFORE_OPEN',
      attempted: 0,
      filled: 0,
      expired: 0,
      lookupFailure: 0,
      notYetTraded: 0,
    });
    expect(repository.findDuePendingOrders).not.toHaveBeenCalled();
    expect(marketData.fetchDailyBars).not.toHaveBeenCalled();
  });

  it('KST 09:30에는 오늘 미조정 봉의 시가로 due 주문을 체결한다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T00:30:00.000Z') }),
    ).resolves.toMatchObject({
      window: 'TRADING',
      attempted: 1,
      filled: 1,
      expired: 0,
      lookupFailure: 0,
      notYetTraded: 0,
    });
    expect(repository.findDuePendingOrders).toHaveBeenCalledWith(
      new Date('2026-08-13T00:00:00.000Z'),
    );
    expect(marketData.fetchDailyBars).toHaveBeenCalledWith('005930', 1, {
      adjusted: false,
    });
    expect(executeOrder.execute).toHaveBeenCalledWith({
      orderId: 101,
      accountId: 11,
      tickerId: 21,
      market: 'KOSPI',
      side: 'BUY',
      requestedQuantity: '10',
      price: '70000',
      tradeDate: '2026-08-13',
      strategy: 'LONG_TERM',
    });
  });

  it('조회 예외는 PENDING을 유지하고 조회실패로 집계한다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    jest.mocked(marketData.fetchDailyBars).mockRejectedValue(new Error('429'));

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T01:00:00.000Z') }),
    ).resolves.toMatchObject({
      window: 'TRADING',
      attempted: 1,
      filled: 0,
      expired: 0,
      lookupFailure: 1,
      notYetTraded: 0,
    });
    expect(repository.expirePendingOrder).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  it('장중 응답에 오늘 봉이 없으면 별도 집계하고 PENDING을 유지한다', async () => {
    const { usecase, repository, marketData } = createFixture();
    jest.mocked(marketData.fetchDailyBars).mockResolvedValue([
      {
        tradeDate: new Date('2026-08-12T00:00:00.000Z'),
        open: decimal('69000'),
        close: decimal('70000'),
        adjClose: decimal('70000'),
        volume: 1n,
        currency: 'KRW',
      },
    ]);

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T01:00:00.000Z') }),
    ).resolves.toMatchObject({
      window: 'TRADING',
      attempted: 1,
      filled: 0,
      expired: 0,
      lookupFailure: 0,
      notYetTraded: 1,
    });
    expect(repository.expirePendingOrder).not.toHaveBeenCalled();
  });

  it('오늘 봉에 시가가 빠지면 조회 실패로 보고 PENDING을 유지한다', async () => {
    const { usecase, repository, marketData } = createFixture();
    jest.mocked(marketData.fetchDailyBars).mockResolvedValue([
      {
        tradeDate: new Date('2026-08-13T00:00:00.000Z'),
        close: decimal('70000'),
        adjClose: decimal('70000'),
        volume: 1n,
        currency: 'KRW',
      },
    ]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-13T01:00:00.000Z'),
    });

    expect(result.lookupFailure).toBe(1);
    expect(result.notYetTraded).toBe(0);
    expect(repository.expirePendingOrder).not.toHaveBeenCalled();
  });

  it('주문을 순서대로 개별 조회하고 체결·만료 결과를 집계한다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder(),
      dueOrder({
        id: 102,
        tickerId: 22,
        tickerCode: '000660',
        tossSymbol: '000660',
      }),
      dueOrder({
        id: 103,
        tickerId: 23,
        tickerCode: '035420',
        tossSymbol: '035420',
      }),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValueOnce([
        {
          tradeDate: new Date('2026-08-13T00:00:00.000Z'),
          open: decimal('70000'),
          close: decimal('70000'),
          adjClose: decimal('70000'),
          volume: 1n,
          currency: 'KRW',
        },
      ])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('timeout'));
    executeOrder.execute.mockResolvedValueOnce({ status: 'FILLED' });

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T06:30:00.000Z') }),
    ).resolves.toMatchObject({
      window: 'TRADING',
      attempted: 3,
      filled: 1,
      expired: 0,
      lookupFailure: 1,
      notYetTraded: 1,
    });
    expect(
      jest
        .mocked(marketData.fetchDailyBars)
        .mock.calls.map(([symbol]) => symbol),
    ).toEqual(['005930', '000660', '035420']);
  });

  it('KST 15:30분 전체는 scheduler 지연이 있어도 처리 창에 포함한다', async () => {
    const { usecase } = createFixture();

    const result = await usecase.execute({
      executedAt: new Date('2026-08-13T06:30:59.999Z'),
    });

    expect(result.window).toBe('TRADING');
    expect(result.filled).toBe(1);
  });

  it('휴장일 장 마감 후에는 due PENDING을 만료하지 않는다', async () => {
    const { usecase, repository, marketData } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder(),
      dueOrder({ id: 102, tickerId: 22, tossSymbol: '000660' }),
    ]);
    jest.mocked(marketData.fetchDailyBars).mockResolvedValue([]);

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T06:31:00.000Z') }),
    ).resolves.toMatchObject({
      window: 'AFTER_CLOSE',
      attempted: 2,
      filled: 0,
      expired: 0,
      lookupFailure: 0,
      notYetTraded: 2,
    });
    expect(repository.expireDuePendingOrders).not.toHaveBeenCalled();
  });

  it('개장일 장 마감 후에는 봉이 있는 주문을 체결하고 남은 due PENDING을 만료한다', async () => {
    const { usecase, repository, marketData } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder(),
      dueOrder({ id: 102, tickerId: 22, tossSymbol: '000660' }),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValueOnce([
        {
          tradeDate: new Date('2026-08-13T00:00:00.000Z'),
          open: decimal('70000'),
          close: decimal('71000'),
          adjClose: decimal('71000'),
          volume: 1n,
          currency: 'KRW',
        },
      ])
      .mockResolvedValueOnce([]);
    repository.expireDuePendingOrders.mockResolvedValue({
      attempted: 1,
      expired: 1,
    });

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T06:31:00.000Z') }),
    ).resolves.toMatchObject({
      window: 'AFTER_CLOSE',
      attempted: 2,
      filled: 1,
      expired: 1,
      lookupFailure: 0,
      notYetTraded: 1,
    });
    expect(repository.expireDuePendingOrders).toHaveBeenCalledWith(
      new Date('2026-08-13T00:00:00.000Z'),
      '체결가 조회 실패',
    );
  });

  it('공급자 전면 장애가 난 장 마감 후에는 due PENDING을 만료하지 않는다', async () => {
    const { usecase, repository, marketData } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder(),
      dueOrder({ id: 102, tickerId: 22, tossSymbol: '000660' }),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockRejectedValue(new Error('provider unavailable'));

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-13T06:31:00.000Z') }),
    ).resolves.toMatchObject({
      window: 'AFTER_CLOSE',
      attempted: 2,
      filled: 0,
      expired: 0,
      lookupFailure: 2,
      notYetTraded: 0,
    });
    expect(repository.expireDuePendingOrders).not.toHaveBeenCalled();
  });
  it('체결 상세에 종목·체결 수량·체결가를 담는다', async () => {
    const { usecase, executeOrder } = createFixture();
    // 현금 한도로 주문 10주가 4주만 체결된 상황 — 주문 수량이 아니라 체결 수량이 남아야 한다.
    executeOrder.execute.mockResolvedValue({
      status: 'FILLED',
      quantity: '4',
    });

    const result = await usecase.execute({
      executedAt: new Date('2026-08-13T01:00:00.000Z'),
    });

    expect(result.details).toEqual([
      {
        accountName: 'PAPER_LONG_TERM',
        tickerName: '삼성전자',
        tickerCode: '005930',
        side: 'BUY',
        outcome: 'FILLED',
        quantity: '4',
        price: '70000',
        reason: null,
      },
    ]);
  });

  it('체결되지 않은 주문의 사유를 상세로 남긴다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder(),
      dueOrder({ id: 102, tickerId: 22, tossSymbol: '000660' }),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValueOnce([
        {
          tradeDate: new Date('2026-08-13T00:00:00.000Z'),
          open: decimal('70000'),
          close: decimal('71000'),
          adjClose: decimal('71000'),
          volume: 1n,
          currency: 'KRW',
        },
      ])
      .mockResolvedValueOnce([]);
    executeOrder.execute.mockResolvedValue({
      status: 'EXPIRED',
      statusReason: '현금 부족',
    });

    const result = await usecase.execute({
      executedAt: new Date('2026-08-13T01:00:00.000Z'),
    });

    expect(result.details).toMatchObject([
      { outcome: 'EXPIRED', reason: '현금 부족', price: null },
      { outcome: 'NOT_YET_TRADED', reason: null, price: null, quantity: '10' },
    ]);
  });

  it('장 마감 후 일괄 만료 대상은 상세에서도 만료로 교정한다', async () => {
    const { usecase, repository, marketData } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder(),
      dueOrder({ id: 102, tickerId: 22, tossSymbol: '000660' }),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValueOnce([
        {
          tradeDate: new Date('2026-08-13T00:00:00.000Z'),
          open: decimal('70000'),
          close: decimal('71000'),
          adjClose: decimal('71000'),
          volume: 1n,
          currency: 'KRW',
        },
      ])
      .mockResolvedValueOnce([]);
    repository.expireDuePendingOrders.mockResolvedValue({
      attempted: 1,
      expired: 1,
    });

    const result = await usecase.execute({
      executedAt: new Date('2026-08-13T06:31:00.000Z'),
    });

    // 두 번째 주문은 오늘 봉이 없어 미체결로 남았다가 곧 일괄 만료된다. 상세를
    // NOT_YET_TRADED 로 두면 취소된 주문을 "다음 회차 재시도" 로 보고하게 된다.
    expect(result.details).toMatchObject([
      { outcome: 'FILLED' },
      { outcome: 'EXPIRED', reason: '체결가 조회 실패' },
    ]);
    expect(result.expired).toBe(1);
    // 종목을 아는 만큼 상세로 설명했으니 식별 불가 건수는 남지 않는다.
    expect(result.bulkExpired).toBe(0);
  });

  it('상세로 설명하지 못한 일괄 만료분만 건수로 남긴다', async () => {
    const { usecase, repository, marketData } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([dueOrder()]);
    jest.mocked(marketData.fetchDailyBars).mockResolvedValue([
      {
        tradeDate: new Date('2026-08-13T00:00:00.000Z'),
        open: decimal('70000'),
        close: decimal('71000'),
        adjClose: decimal('71000'),
        volume: 1n,
        currency: 'KRW',
      },
    ]);
    // 조회 이후 다른 회차가 만든 주문까지 쓸려 만료 건수가 상세보다 많은 상황.
    repository.expireDuePendingOrders.mockResolvedValue({
      attempted: 2,
      expired: 2,
    });

    const result = await usecase.execute({
      executedAt: new Date('2026-08-13T06:31:00.000Z'),
    });

    expect(result.bulkExpired).toBe(2);
    expect(result.details).toMatchObject([{ outcome: 'FILLED' }]);
  });
});
