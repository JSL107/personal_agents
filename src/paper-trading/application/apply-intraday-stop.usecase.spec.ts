import { Prisma } from '@prisma/client';

import { MarketDataPort } from '../../market-data/domain/port/market-data.port';
import { ResolveStrategyParametersUsecase } from '../../strategy-parameter/application/resolve-strategy-parameters.usecase';
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
  // 손절선은 종가 밴드와 같은 원장에서 온다. 기본 mock 은 현행 운영값을 돌려준다.
  const strategyParameters = {
    execute: jest.fn().mockResolvedValue({
      exitBand: { takeProfitPercent: 10, stopLossPercent: -5 },
      minimumTurnover60: 500_000_000,
      maximumWeightPercent: 20,
    }),
  };
  const usecase = new ApplyIntradayStopUsecase(
    repository as unknown as PaperTradingPrismaRepository,
    marketData as MarketDataPort,
    executeOrder as unknown as ExecutePaperOrderUsecase,
    strategyParameters as unknown as ResolveStrategyParametersUsecase,
  );
  return { usecase, repository, marketData, executeOrder, strategyParameters };
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
      priceErrorCount: 0,
      notTradedCount: 0,
      corporateActionCount: 0,
      corporateActions: [],
      fillFailureCount: 0,
      accountFailures: [],
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
      priceErrorCount: 0,
      notTradedCount: 0,
      corporateActionCount: 0,
      corporateActions: [],
      fillFailureCount: 0,
      accountFailures: [],
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
      priceErrorCount: 0,
      notTradedCount: 0,
      corporateActionCount: 0,
      corporateActions: [],
      fillFailureCount: 0,
      accountFailures: [],
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

    expect(result.priceErrorCount).toBe(1);
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

    expect(result.notTradedCount).toBe(1);
    expect(result.inspectedCount).toBe(0);
    expect(result.decidedCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  // 손절선을 상수에서 읽으면 원장에서 값을 바꿨을 때 종가 밴드만 따라가고 장중 손절은
  // 옛 값에 남아, 같은 계좌가 두 기준으로 청산된다.
  it('손절선을 코드 상수가 아니라 전략 파라미터 원장에서 읽는다', async () => {
    const { usecase, repository, marketData, strategyParameters } =
      createFixture();
    // 원장이 -3% 를 준다. 코드 상수(-5%)를 읽었다면 -4% 종목은 손절되지 않는다.
    strategyParameters.execute.mockResolvedValue({
      exitBand: { takeProfitPercent: 8, stopLossPercent: -3 },
      minimumTurnover60: 500_000_000,
      maximumWeightPercent: 20,
    });
    // 평단 100 에 현재가 96 이면 -4% 다. 상수 -5% 로는 걸리지 않고 원장 -3% 로는 걸린다.
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValue([dailyBar('2026-08-25', '96')]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(strategyParameters.execute).toHaveBeenCalledWith('SWING');
    expect(result.decidedCount).toBe(1);
    // 주문에 박히는 밴드도 원장 값이어야 성적 집계가 전후를 가를 수 있다.
    expect(repository.createExitBandOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        threshold: { takeProfitPercent: 8, stopLossPercent: -3 },
      }),
    );
  });

  // 주문만 만들고 체결에 실패하면 그 SELL 은 PENDING 으로 남고, 같은 거래일에 도는
  // 체결기가 그것을 당일 **시가**로 체결한다 — 장중 손절이 시가 매도로 둔갑한다.
  // 게다가 다음 회차는 PENDING 이 있어 판정만 하고 건너뛰므로 스스로 회복하지도 못한다.
  it('체결이 예외로 끊기면 방금 만든 주문을 되돌린다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    jest
      .mocked(executeOrder.execute)
      .mockRejectedValue(new Error('ledger unavailable'));

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.decidedCount).toBe(1);
    expect(result.filledCount).toBe(0);
    expect(result.fillFailureCount).toBe(1);
    expect(repository.expirePendingOrder).toHaveBeenCalledWith(
      101,
      '장중 손절 체결 실패',
    );
  });

  it('체결이 FILLED 가 아니면 주문을 PENDING 으로 남기지 않는다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    jest
      .mocked(executeOrder.execute)
      .mockResolvedValue({ status: 'EXPIRED', statusReason: '현금 부족' });

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.filledCount).toBe(0);
    expect(result.fillFailureCount).toBe(1);
    expect(repository.expirePendingOrder).toHaveBeenCalledWith(
      101,
      '장중 손절 체결 실패',
    );
  });

  // 되돌리기까지 실패해도 그 계좌의 나머지 종목 처리를 접지 않는다.
  it('되돌리기가 실패해도 예외를 올리지 않는다', async () => {
    const { usecase, repository, executeOrder } = createFixture();
    jest
      .mocked(executeOrder.execute)
      .mockRejectedValue(new Error('ledger unavailable'));
    repository.expirePendingOrder.mockRejectedValue(new Error('db down'));

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.fillFailureCount).toBe(1);
    expect(result.accountFailureCount).toBe(0);
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
  // 2026-08-28 코람코더원리츠 재현. 주당 8,640원 배당락으로 종가가 10,930원에서 2,335원이
  // 되자 평가 손익률이 -78.68% 로 잡혔고, 그 가격 그대로 182주가 청산돼 계좌에 -156만원이
  // 확정됐다. 배당금은 장부에 들어오지 않으므로 그 손실은 스스로 회복되지 않는다.
  it('배당락처럼 가격제한 밖으로 튄 종목은 손절하지 않고 보류한다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    repository.findPositionsWithTicker.mockResolvedValue([
      position(21, '005930', { avgPrice: decimal('10880') }),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValue([
        dailyBar('2026-08-22', '10930'),
        dailyBar('2026-08-25', '2335'),
      ]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.corporateActionCount).toBe(1);
    expect(result.corporateActions).toEqual([
      '종목 005930(005930) 가격이 전일 대비 0.21363220494053064959배로 ' +
        '변했습니다 — 하루 가격제한(±30%) 밖이라 분할·병합·배당락 또는 시세 오류로 봅니다.',
    ]);
    // 판정 자체를 하지 않았으므로 검사 건수에도 들어가지 않는다.
    expect(result.inspectedCount).toBe(0);
    expect(result.decidedCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
    expect(executeOrder.execute).not.toHaveBeenCalled();
  });

  // 위 테스트의 대조군. 같은 가격·같은 평단인데 전일 봉만 없애면 손절이 그대로 나간다 —
  // 보류가 가드 때문이지 다른 조건 덕이 아니라는 증명이다. 실제 사고도 이 상태였다.
  // 손절 경로가 1봉만 받아 전일 종가를 손에 쥐지 못했다.
  it('전일 봉이 없으면 같은 가격이라도 막지 못하고 손절이 나간다', async () => {
    const { usecase, repository, marketData, executeOrder } = createFixture();
    repository.findPositionsWithTicker.mockResolvedValue([
      position(21, '005930', { avgPrice: decimal('10880') }),
    ]);
    jest
      .mocked(marketData.fetchDailyBars)
      .mockResolvedValue([dailyBar('2026-08-25', '2335')]);

    const result = await usecase.execute({
      executedAt: new Date('2026-08-25T02:00:00.000Z'),
    });

    expect(result.corporateActionCount).toBe(0);
    expect(result.inspectedCount).toBe(1);
    expect(result.decidedCount).toBe(1);
    expect(executeOrder.execute).toHaveBeenCalled();
  });
});
