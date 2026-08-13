import { FillPendingOrdersUsecase } from '../../../paper-trading/application/fill-pending-orders.usecase';
import { PaperOrderFillAutopilotTask } from './paper-order-fill.autopilot-task';

describe('PaperOrderFillAutopilotTask', () => {
  it('production 체결 usecase 결과를 시도·체결·만료·조회실패 요약으로 반환한다', async () => {
    const fillPendingOrders = {
      execute: jest.fn().mockResolvedValue({
        window: 'TRADING',
        attempted: 5,
        filled: 2,
        expired: 1,
        lookupFailure: 2,
        notYetTraded: 1,
      }),
    };
    const task = new PaperOrderFillAutopilotTask(
      fillPendingOrders as unknown as FillPendingOrdersUsecase,
    );

    await expect(
      task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-17' }),
    ).resolves.toEqual({
      skip: false,
      summaryText:
        '모의투자 체결 완료 — 시도 5건, 체결 2건, 만료 1건, 조회 실패 2건, 당일 봉 대기 1건',
    });
    expect(fillPendingOrders.execute).toHaveBeenCalledWith();
  });

  it('체결 시간 창 밖 회차를 일반 0건 실행과 구분해 skip한다', async () => {
    const fillPendingOrders = {
      execute: jest.fn().mockResolvedValue({
        window: 'BEFORE_OPEN',
        attempted: 0,
        filled: 0,
        expired: 0,
        lookupFailure: 0,
        notYetTraded: 0,
      }),
    };
    const task = new PaperOrderFillAutopilotTask(
      fillPendingOrders as unknown as FillPendingOrdersUsecase,
    );

    await expect(
      task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-17' }),
    ).resolves.toEqual({
      skip: true,
      summaryText: '모의투자 체결 시간 창 이전 — 주문 미처리',
    });
  });
});
