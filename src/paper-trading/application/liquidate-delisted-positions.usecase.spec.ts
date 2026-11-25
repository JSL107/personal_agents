import { Prisma } from '@prisma/client';

import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { ExecutePaperOrderUsecase } from './execute-paper-order.usecase';
import { LiquidateDelistedPositionsUsecase } from './liquidate-delisted-positions.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

// 2026-11-25 17:40 KST
const EXECUTED_AT = new Date('2026-11-25T08:40:00.000Z');
const TRADE_DAY = new Date('2026-11-25T00:00:00.000Z');

const delistedPosition = (overrides: Record<string, unknown> = {}) => ({
  tickerId: 178,
  tickerCode: '417310',
  tickerName: '코람코더원리츠',
  krxMarket: 'KOSPI',
  quantity: decimal('743'),
  delistedAt: new Date('2026-11-20T00:00:00.000Z'),
  lastClose: decimal('2455'),
  lastCloseDate: new Date('2026-11-19T00:00:00.000Z'),
  ...overrides,
});

const dueOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 901,
  accountId: 5,
  accountName: 'LONG_TERM',
  tickerId: 178,
  tickerCode: '417310',
  tickerName: '코람코더원리츠',
  tossSymbol: '417310',
  krxMarket: 'KOSPI',
  side: 'SELL',
  quantity: decimal('743'),
  strategy: 'LONG_TERM',
  reason: '상장폐지 청산',
  targetTradeDate: TRADE_DAY,
  ...overrides,
});

const createFixture = () => {
  const repository = {
    findAllAccounts: jest
      .fn()
      .mockResolvedValue([{ id: 5, name: 'LONG_TERM' }]),
    findDelistedPositions: jest.fn().mockResolvedValue([delistedPosition()]),
    createExitBandOrders: jest.fn().mockResolvedValue({
      created: 1,
      createdTickerIds: [178],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
    }),
    findDuePendingOrders: jest.fn().mockResolvedValue([dueOrder()]),
    expirePendingOrder: jest.fn().mockResolvedValue(true),
    expirePendingOrdersForTickers: jest.fn().mockResolvedValue(0),
    findDelistedLiquidationTrades: jest.fn().mockResolvedValue([]),
  };
  const executeOrder = {
    execute: jest.fn().mockResolvedValue({ status: 'FILLED', quantity: '743' }),
  };
  const usecase = new LiquidateDelistedPositionsUsecase(
    repository as unknown as PaperTradingPrismaRepository,
    executeOrder as unknown as ExecutePaperOrderUsecase,
  );
  return { usecase, repository, executeOrder };
};

describe('LiquidateDelistedPositionsUsecase', () => {
  it('폐지 종목을 밴드 값 없이 주문하고 마지막 종가로 그날 체결한다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    const ledgerTrade = {
      accountName: 'LONG_TERM',
      tickerCode: '417310',
      tickerName: '코람코더원리츠',
      quantity: '743',
      price: '2455',
    };
    repository.findDelistedLiquidationTrades.mockResolvedValue([ledgerTrade]);

    const result = await usecase.execute({
      executedAt: EXECUTED_AT,
      agentRunId: 77,
    });

    expect(repository.findDelistedPositions).toHaveBeenCalledWith({
      accountId: 5,
      onOrBefore: TRADE_DAY,
    });
    expect(repository.createExitBandOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 5,
        strategy: 'LONG_TERM',
        targetTradeDate: TRADE_DAY,
        agentRunId: 77,
        threshold: null,
        orders: [
          {
            tickerId: 178,
            reason:
              '상장폐지 청산: 2026-11-20 폐지 · 마지막 종가 2455원(2026-11-19)',
          },
        ],
      }),
    );
    expect(executeOrder.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 901,
        side: 'SELL',
        market: 'KOSPI',
        requestedQuantity: '743',
        price: '2455',
        tradeDate: '2026-11-25',
      }),
    );
    expect(repository.findDelistedLiquidationTrades).toHaveBeenCalledWith(
      TRADE_DAY,
    );
    expect(result).toEqual({ fills: [ledgerTrade], failures: [] });
  });

  it('폐지 보유가 없으면 주문도 체결도 하지 않는다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findDelistedPositions.mockResolvedValue([]);

    const result = await usecase.execute({ executedAt: EXECUTED_AT });

    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ fills: [], failures: [] });
  });

  it('적재된 종가가 없으면 청산가를 지어내지 않고 사유로 남긴다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findDelistedPositions.mockResolvedValue([
      delistedPosition({ lastClose: null, lastCloseDate: null }),
    ]);

    const result = await usecase.execute({ executedAt: EXECUTED_AT });

    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      '코람코더원리츠(417310): 적재된 종가가 없어 청산가를 정할 수 없습니다',
    ]);
  });

  // 기존 대기 주문(미래 목표일·일부 수량·밴드 매도·매수)을 재사용하면 보유가 남거나 엉뚱한
  // 성적으로 잡히고, 남은 대기 매도는 새 주문 생성까지 막는다. 지운 뒤 전량으로 새로 판다.
  it('폐지 종목의 기존 대기 주문을 모두 만료시킨 뒤 새 주문만 체결한다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder(),
      // 다른 계좌·다른 종목·매수는 체결하지 않는다.
      dueOrder({ id: 556, accountId: 6 }),
      dueOrder({ id: 557, tickerId: 21 }),
      dueOrder({ id: 558, side: 'BUY' }),
    ]);

    await usecase.execute({ executedAt: EXECUTED_AT });

    expect(repository.expirePendingOrdersForTickers).toHaveBeenCalledWith({
      accountId: 5,
      tickerIds: [178],
      statusReason: '상장폐지 청산으로 대체',
    });
    expect(
      repository.expirePendingOrdersForTickers.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.createExitBandOrders.mock.invocationCallOrder[0]);
    expect(executeOrder.execute).toHaveBeenCalledTimes(1);
    expect(executeOrder.execute).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 901, requestedQuantity: '743' }),
    );
  });

  // 평가가 실패해 재시도된 회차는 보유가 0 이라 아무것도 팔지 않는다. 그래도 카드에는 그날
  // 앞선 회차가 판 내역이 원장에서 나와야 한다.
  it('팔 보유가 없어도 그날 원장의 청산 내역을 돌려준다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findDelistedPositions.mockResolvedValue([]);
    const ledgerTrade = {
      accountName: 'LONG_TERM',
      tickerCode: '417310',
      tickerName: '코람코더원리츠',
      quantity: '743',
      price: '2455',
    };
    repository.findDelistedLiquidationTrades.mockResolvedValue([ledgerTrade]);

    const result = await usecase.execute({ executedAt: EXECUTED_AT });

    expect(executeOrder.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ fills: [ledgerTrade], failures: [] });
  });

  // 체결 못 한 주문을 PENDING 으로 두면 체결기가 다음 시가로 채우려다 매번 실패한다.
  it('체결에 실패하면 주문을 만료로 되돌리고 사유를 남긴다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    executeOrder.execute.mockRejectedValue(new Error('원장 잠금 실패'));

    const result = await usecase.execute({ executedAt: EXECUTED_AT });

    expect(repository.expirePendingOrder).toHaveBeenCalledWith(
      901,
      '상장폐지 청산 실패',
    );
    expect(result).toEqual({
      fills: [],
      failures: ['코람코더원리츠(417310): 원장 잠금 실패'],
    });
  });

  it('한 계좌의 예외가 다른 계좌의 청산을 막지 않는다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.findAllAccounts.mockResolvedValue([
      { id: 4, name: 'SWING' },
      { id: 5, name: 'LONG_TERM' },
    ]);
    repository.findDelistedPositions
      .mockRejectedValueOnce(new Error('DB 끊김'))
      .mockResolvedValueOnce([delistedPosition()]);

    const result = await usecase.execute({ executedAt: EXECUTED_AT });

    expect(executeOrder.execute).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual(['SWING: DB 끊김']);
  });
});
