import { planPendingOrders } from './pending-order-plan';

describe('planPendingOrders', () => {
  it('대기 매수 두 건의 주문 시점 종가로 현금을 예약한다', () => {
    const plan = planPendingOrders({
      pendingOrders: [
        { tickerId: 11, side: 'BUY', quantity: 2, close: 1_000 },
        { tickerId: 12, side: 'BUY', quantity: 3, close: 2_000 },
      ],
      cashBalance: 10_000,
      codeOf: (tickerId) => (tickerId === 11 ? '000011' : '000012'),
    });

    expect(plan.reservedCash).toBe(8_000);
    expect(plan.availableCash).toBe(2_000);
    expect(plan.pendingBuyCodes).toEqual(new Set(['000011', '000012']));
    expect(plan.reservedPositions).toEqual([
      { tickerId: 11, code: '000011', quantity: 1 },
      { tickerId: 12, code: '000012', quantity: 1 },
    ]);
  });

  it.each([null, 0, Number.NaN])(
    '종가가 %p인 대기 매수는 현금을 예약하지 않는다',
    (close) => {
      const plan = planPendingOrders({
        pendingOrders: [{ tickerId: 11, side: 'BUY', quantity: 2, close }],
        cashBalance: 10_000,
        codeOf: () => '000011',
      });

      expect(plan.reservedCash).toBe(0);
      expect(plan.availableCash).toBe(10_000);
    },
  );

  it('예약액이 잔액보다 크면 사용 가능 현금을 0으로 제한한다', () => {
    const plan = planPendingOrders({
      pendingOrders: [{ tickerId: 11, side: 'BUY', quantity: 2, close: 6_000 }],
      cashBalance: 10_000,
      codeOf: () => '000011',
    });

    expect(plan.reservedCash).toBe(12_000);
    expect(plan.availableCash).toBe(0);
  });

  it('대기 매도는 현금을 예약하지 않는다', () => {
    const plan = planPendingOrders({
      pendingOrders: [
        { tickerId: 11, side: 'SELL', quantity: 2, close: 6_000 },
      ],
      cashBalance: 10_000,
      codeOf: () => '000011',
    });

    expect(plan.reservedCash).toBe(0);
    expect(plan.availableCash).toBe(10_000);
    expect(plan.pendingSellCodes).toEqual(new Set(['000011']));
    expect(plan.pendingTickerIds).toEqual(new Set([11]));
  });

  it('코드를 모르는 대기 매수는 가상 포지션에서만 제외한다', () => {
    const plan = planPendingOrders({
      pendingOrders: [{ tickerId: 11, side: 'BUY', quantity: 2, close: 1_000 }],
      cashBalance: 10_000,
      codeOf: () => undefined,
    });

    expect(plan.pendingTickerIds).toEqual(new Set([11]));
    expect(plan.pendingBuyCodes).toEqual(new Set());
    expect(plan.reservedPositions).toEqual([]);
  });
});
