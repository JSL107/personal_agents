export interface PendingOrderRecord {
  tickerId: number;
  side: 'BUY' | 'SELL';
  quantity: number;
  // 주문을 낸 시점의 종가. 모르면 null 이고, 그 주문은 현금을 예약하지 못한다 —
  // 0 으로 치면 "예약할 게 없다" 와 구분되지 않는다.
  close: number | null;
}

export interface PendingOrderPlan {
  // 대기 매수가 이미 쓰기로 한 현금을 뺀 잔액. 이 값을 제약 함수에 넘기지 않으면
  // 같은 현금이 여러 주문에 중복 배정돼 성적이 실제보다 좋게 나온다.
  availableCash: number;
  reservedCash: number;
  // 대기 매수 종목. 같은 종목을 겹쳐 사지 않도록 추천 후보에서 뺀다.
  pendingBuyCodes: ReadonlySet<string>;
  // 대기 매도 종목. 같은 종목을 또 팔지 않도록 매도 추천에서 뺀다.
  pendingSellCodes: ReadonlySet<string>;
  // 매수·매도 어느 쪽이든 대기 주문이 있는 종목. 회차 안에서 주문을 여러 번 만드는
  // 백테스트 루프가 방금 만든 주문까지 막는 데 쓴다.
  pendingTickerIds: ReadonlySet<number>;
}

export interface PlanPendingOrdersInput {
  pendingOrders: readonly PendingOrderRecord[];
  cashBalance: number;
  codeOf: (tickerId: number) => string | undefined;
}

// 대기 중인 주문을 다음 추천에 어떻게 반영하는가 — 운영 추천과 백테스트 재생이 각각 손으로
// 쓰고 있던 계산을 한 곳에 모았다. 예전에는 예약 현금을 운영은 주문에 실린 지표 스냅샷의
// 종가로, 백테스트는 주문 시점에 따로 저장한 금액 필드로 각각 구했다 — 값이 같아 보이는
// 동안은 아무도 모르고, 한쪽만 고치는 날 갈린다. 규칙을 고칠 일이 생기면 여기 한 곳만 고친다.
//
// 두 경로가 이 결과를 *적용하는* 방식까지 같지는 않다. 실전은 언어모델이 고르므로 대기 매수를
// 가상 포지션으로 끼워 넣어 제약 함수가 거르게 하고, 백테스트는 규칙이 랭킹을 보므로 후보에서
// 뺀다. 선택 주체가 다르기 때문이고, 어느 쪽도 대기 매수를 "보유 정원" 으로 세지 않는다
// (2026-08-16 백테스트 설계 §7 — 연휴 누적 체결은 실전의 정상 동작이라 재현 대상이다).
export const planPendingOrders = (
  input: PlanPendingOrdersInput,
): PendingOrderPlan => {
  let reservedCash = 0;
  const pendingBuyCodes = new Set<string>();
  const pendingSellCodes = new Set<string>();
  const pendingTickerIds = new Set<number>();

  for (const order of input.pendingOrders) {
    pendingTickerIds.add(order.tickerId);
    // 코드를 모르는 종목은 코드로 매칭하는 집합에 넣을 수 없다. 그래도 pendingTickerIds
    // 에는 남는다 — 후보에도 없는 종목이라 추천으로 올라올 수 없다.
    const code = input.codeOf(order.tickerId);
    if (order.side === 'SELL') {
      if (code !== undefined) {
        pendingSellCodes.add(code);
      }
      continue;
    }

    if (
      order.close !== null &&
      Number.isFinite(order.close) &&
      order.close > 0
    ) {
      reservedCash += order.quantity * order.close;
    }
    if (code === undefined) {
      continue;
    }
    pendingBuyCodes.add(code);
  }

  return {
    availableCash: Math.max(0, input.cashBalance - reservedCash),
    reservedCash,
    pendingBuyCodes,
    pendingSellCodes,
    pendingTickerIds,
  };
};
