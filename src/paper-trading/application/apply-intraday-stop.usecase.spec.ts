import { Prisma } from '@prisma/client';

import { MarketDataPort } from '../../market-data/domain/port/market-data.port';
import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { ApplyIntradayStopUsecase } from './apply-intraday-stop.usecase';
import { ExecutePaperOrderUsecase } from './execute-paper-order.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

const account = (id: number, name: string) => ({
  id,
  name,
  seedAmount: decimal('1000000'),
  cashBalance: decimal('500000'),
});

const position = (
  tickerId: number,
  tickerCode: string,
  overrides: Record<string, unknown> = {},
) => ({
  id: tickerId + 100,
  accountId: 11,
  tickerId,
  quantity: decimal('10'),
  avgPrice: decimal('100'),
  ticker: {
    code: tickerCode,
    name: `종목 ${tickerCode}`,
    tossSymbol: tickerCode,
  },
  ...overrides,
});

const dailyBar = (tradeDate: string, close: string) => ({
  tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
  open: decimal(close),
  close: decimal(close),
  adjClose: decimal(close),
  volume: 1n,
  currency: 'KRW',
});

const dueOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  accountId: 11,
  accountName: 'SWING',
  tickerId: 21,
  tickerCode: '005930',
  tickerName: '종목 005930',
  tossSymbol: '005930',
  krxMarket: 'KOSPI',
  side: 'SELL' as const,
  quantity: decimal('10'),
  strategy: 'SWING' as const,
  reason: '장중 손절',
  targetTradeDate: new Date('2026-08-25T00:00:00.000Z'),
  ...overrides,
});

const createFixture = () => {
  const repository = {
    findAllAccounts: jest.fn().mockResolvedValue([account(11, 'SWING')]),
    findPositionsWithTicker: jest
      .fn()
      .mockResolvedValue([position(21, '005930')]),
    createExitBandOrders: jest.fn().mockResolvedValue({
      created: 1,
      createdTickerIds: [21],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
    }),
    findDuePendingOrders: jest.fn().mockResolvedValue([dueOrder()]),
    expirePendingOrder: jest.fn().mockResolvedValue(true),
  };
  const marketData: Pick<MarketDataPort, 'fetchDailyBars'> = {
    fetchDailyBars: jest.fn().mockResolvedValue([dailyBar('2026-08-25', '94')]),
  };
  const executeOrder = {
    execute: jest.fn().mockResolvedValue({
      status: 'FILLED',
      quantity: '10',
    }),
  };
  const usecase = new ApplyIntradayStopUsecase(
    repository as unknown as PaperTradingPrismaRepository,
    marketData as MarketDataPort,
    executeOrder as unknown as ExecutePaperOrderUsecase,
  );
  return { usecase, repository, marketData, executeOrder };
};

describe('ApplyIntradayStopUsecase', () => {
  it('KST 09:00에는 시세를 조회하지 않고 BEFORE_OPEN을 반환한다', async () => {
    const { usecase, repository, marketData } = createFixture();

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-25T00:00:00.000Z') }),
    ).resolves.toEqual({
      window: 'BEFORE_OPEN',
      accountCount: 0,
      inspectedCount: 0,
      lookupFailureCount: 0,
      decidedCount: 0,
      filledCount: 0,
      fills: [],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
      accountFailureCount: 0,
    });
    expect(repository.findAllAccounts).not.toHaveBeenCalled();
    expect(marketData.fetchDailyBars).not.toHaveBeenCalled();
  });

  it('KST 15:25에는 시세를 조회하지 않고 AFTER_CLOSE를 반환한다', async () => {
    const { usecase, repository, marketData } = createFixture();

    await expect(
      usecase.execute({ executedAt: new Date('2026-08-25T06:25:00.000Z') }),
    ).resolves.toEqual({
      window: 'AFTER_CLOSE',
      accountCount: 0,
      inspectedCount: 0,
      lookupFailureCount: 0,
      decidedCount: 0,
      filledCount: 0,
      fills: [],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
      accountFailureCount: 0,
    });
    expect(repository.findAllAccounts).not.toHaveBeenCalled();
    expect(marketData.fetchDailyBars).not.toHaveBeenCalled();
  });

  it('보유 2종 중 -6%인 1종만 주문을 만들고 판정가로 즉시 체결한다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    repository.findPositionsWithTicker.mockResolvedValue([
      position(21, '005930'),
      position(22, '000660'),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValueOnce([dailyBar('2026-08-25', '94')])
      .mockResolvedValueOnce([dailyBar('2026-08-25', '102')]);
    executeOrder.execute.mockResolvedValue({
      status: 'FILLED',
      quantity: '7',
    });

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
      agentRunId: 31,
    });

    expect(result).toEqual({
      window: 'TRADING',
      accountCount: 1,
      inspectedCount: 2,
      lookupFailureCount: 0,
      decidedCount: 1,
      filledCount: 1,
      fills: [
        {
          accountName: 'SWING',
          tickerCode: '005930',
          tickerName: '종목 005930',
          quantity: '7',
          price: '94',
          returnRatePercent: -6,
        },
      ],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
      accountFailureCount: 0,
    });
    expect(repository.createExitBandOrders).toHaveBeenCalledWith({
      accountId: 11,
      strategy: 'SWING',
      decidedAt: new Date('2026-08-25T02:00:00.000Z'),
      dataAsOf: new Date('2026-08-25T00:00:00.000Z'),
      targetTradeDate: new Date('2026-08-25T00:00:00.000Z'),
      agentRunId: 31,
      threshold: { takeProfitPercent: 10, stopLossPercent: -5 },
      orders: [
        {
          tickerId: 21,
          reason:
            '장중 손절 밴드 이탈: 평가 손익률 -6.00% (기준 -5% 이하, 판정가 94원)',
        },
      ],
    });
    expect(executeOrder.execute).toHaveBeenCalledWith({
      orderId: 101,
      accountId: 11,
      tickerId: 21,
      market: 'KOSPI',
      side: 'SELL',
      requestedQuantity: '10',
      price: '94',
      tradeDate: '2026-08-25',
      strategy: 'SWING',
    });
  });

  it('수익률 +20%인 보유 종목은 장중 익절하지 않는다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValue([dailyBar('2026-08-25', '120')]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.inspectedCount).toBe(1);
    expect(result.decidedCount).toBe(0);
    expect(result.filledCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  it('시세 조회 예외를 실패로 집계하고 해당 종목을 판정하지 않는다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    jest
      .mocked(marketData.fetchDailyBars)
      .mockRejectedValue(new Error('provider unavailable'));

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.lookupFailureCount).toBe(1);
    expect(result.inspectedCount).toBe(0);
    expect(result.decidedCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  it('오늘 KST 봉이 없으면 어제 봉으로 손절하지 않는다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValue([dailyBar('2026-08-24', '80')]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.lookupFailureCount).toBe(1);
    expect(result.inspectedCount).toBe(0);
    expect(result.decidedCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  it('같은 계좌의 unrelated pending BUY는 장중 손절 체결에서 제외한다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder({
        id: 100,
        tickerId: 22,
        tickerCode: '000660',
        side: 'BUY',
      }),
      dueOrder({ id: 101 }),
    ]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.filledCount).toBe(1);
    expect(executeOrder.execute).toHaveBeenCalledTimes(1);
    expect(executeOrder.execute).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 101, side: 'SELL' }),
    );
  });

  it('pending SELL로 생성이 skip된 종목은 판정돼도 기존 주문을 체결하지 않는다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.createExitBandOrders.mockResolvedValue({
      created: 0,
      createdTickerIds: [],
      skippedByPendingSell: 1,
      skippedByNoPosition: 0,
    });
    repository.findDuePendingOrders.mockResolvedValue([dueOrder()]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.decidedCount).toBe(1);
    expect(result.skippedByPendingSell).toBe(1);
    expect(result.filledCount).toBe(0);
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  it('시장 구분이 없는 방금 생성된 SELL만 정확한 사유로 만료한다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder({ id: 100, tickerId: 22, side: 'BUY', krxMarket: null }),
      dueOrder({ id: 101, krxMarket: null }),
    ]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.decidedCount).toBe(1);
    expect(result.filledCount).toBe(0);
    expect(repository.expirePendingOrder).toHaveBeenCalledTimes(1);
    expect(repository.expirePendingOrder).toHaveBeenCalledWith(
      101,
      '종목 시장 구분 없음',
    );
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  it('한 계좌의 position 조회 실패가 뒤 계좌 처리를 막지 않는다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findAllAccounts.mockResolvedValue([
      account(11, 'LONG_TERM'),
      account(12, 'SWING'),
    ]);
    repository.findPositionsWithTicker
      .mockRejectedValueOnce(new Error('account read failed'))
      .mockResolvedValueOnce([
        position(31, '035420', {
          accountId: 12,
          ticker: {
            code: '035420',
            name: '종목 035420',
            tossSymbol: '035420',
          },
        }),
      ]);
    repository.createExitBandOrders.mockResolvedValue({
      created: 1,
      createdTickerIds: [31],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
      accountFailureCount: 0,
    });
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder({
        id: 201,
        accountId: 12,
        tickerId: 31,
        tickerCode: '035420',
        tickerName: '종목 035420',
      }),
    ]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.accountCount).toBe(2);
    expect(result.inspectedCount).toBe(1);
    expect(result.decidedCount).toBe(1);
    expect(result.filledCount).toBe(1);
    // 격리는 실패를 감추는 것이 아니다. 이 단언이 빠지면 삼킨 예외가
    // "손절 0건" 과 구분되지 않아 고장난 회차가 정상으로 보고된다.
    expect(result.accountFailureCount).toBe(1);
    expect(executeOrder.execute).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 12, tickerId: 31 }),
    );
  });
});
