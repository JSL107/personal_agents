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
    expect(result).toEqual({
      fills: [
        {
          accountName: 'LONG_TERM',
          tickerCode: '417310',
          tickerName: '코람코더원리츠',
          quantity: '743',
          price: '2455',
          priceDate: '2026-11-19',
        },
      ],
      failures: [],
    });
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

  // 밴드가 먼저 걸어 둔 매도는 시가가 없어 체결기가 영영 못 채운다. 그 PENDING 때문에 새 주문은
  // 건너뛰어지므로 기존 주문을 집어 체결해야 보유가 빠진다.
  it('이미 걸려 있던 매도 주문도 마지막 종가로 체결한다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    repository.createExitBandOrders.mockResolvedValue({
      created: 0,
      createdTickerIds: [],
      skippedByPendingSell: 1,
      skippedByNoPosition: 0,
    });
    repository.findDuePendingOrders.mockResolvedValue([
      dueOrder({ id: 555, reason: '종가 밴드 손절' }),
      // 다른 계좌·다른 종목·매수는 건드리지 않는다.
      dueOrder({ id: 556, accountId: 6 }),
      dueOrder({ id: 557, tickerId: 21 }),
      dueOrder({ id: 558, side: 'BUY' }),
    ]);

    const result = await usecase.execute({ executedAt: EXECUTED_AT });

    expect(executeOrder.execute).toHaveBeenCalledTimes(1);
    expect(executeOrder.execute).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 555, price: '2455' }),
    );
    expect(result.fills).toHaveLength(1);
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
    expect(result.fills).toHaveLength(1);
    expect(result.failures).toEqual(['SWING: DB 끊김']);
  });
});
