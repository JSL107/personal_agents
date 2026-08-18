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
