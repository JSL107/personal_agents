const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const getKstClock = (
  date: Date,
): { tradeDate: string; minutes: number } => {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    tradeDate: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};

// 주문의 목표 거래일 계산. 체결기는 `targetTradeDate <= 오늘` 로 조회하므로 주말 날짜를
// 적어도 결국 월요일에 체결되기는 한다. 그래도 주말을 건너뛰는 이유는 원장 때문이다 —
// "무엇을 보고 언제 체결할 작정이었나" 를 사후에 증명하는 표에 장이 열리지 않는 날짜가
// 남으면, 그 주문의 판단 시점과 체결 시점을 재구성할 수 없다.
//
// 추천(PAPER_RECOMMEND)과 밴드 청산이 같은 규칙을 써야 한다. 한쪽에만 두면 나중에 한쪽만
// 고쳐진다.
export const nextWeekday = (currentDate: Date): Date => {
  const nextDate = new Date(
    Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate() + 1,
    ),
  );
  while (nextDate.getUTCDay() === 0 || nextDate.getUTCDay() === 6) {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  }
  return nextDate;
};

// 결제일 = 체결일 + 2영업일. 공휴일 테이블이 없어 주말만 건너뛴다(nextWeekday 와 같은 한계).
// 총평가에 영향이 없는 표시용 값이라 이 근사로 충분하다 — 정확한 개장일은 daily_price 행
// 존재로만 알 수 있는데 미래 날짜에는 그 행이 없다.
export const settlementDateOf = (tradeDate: Date): Date =>
  nextWeekday(nextWeekday(tradeDate));
