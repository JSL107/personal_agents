import {
  addKrxTradingDays,
  HolidayCalendar,
  nextKrxTradingDay,
} from '../../holiday/domain/business-calendar';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SETTLEMENT_TRADING_DAYS = 2;

export const getKstClock = (
  date: Date,
): { tradeDate: string; minutes: number } => {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    tradeDate: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};

// 주문의 목표 거래일 계산. 체결기는 `targetTradeDate <= 오늘` 로 조회하므로 휴장일 날짜를
// 적어도 결국 다음 개장일에 체결되기는 한다. 그래도 휴장일을 건너뛰는 이유는 원장 때문이다 —
// "무엇을 보고 언제 체결할 작정이었나" 를 사후에 증명하는 표에 장이 열리지 않는 날짜가
// 남으면, 그 주문의 판단 시점과 체결 시점을 재구성할 수 없다.
//
// 추천(PAPER_RECOMMEND)과 밴드 청산이 같은 규칙을 써야 한다. 한쪽에만 두면 나중에 한쪽만
// 고쳐진다 — 둘 다 이 함수를 거친다.
export const targetTradeDateOf = (
  decidedAt: Date,
  calendar: HolidayCalendar,
): Date => nextKrxTradingDay(decidedAt, calendar);

// 결제일 = 체결일 + 2거래일.
export const settlementDateOf = (
  tradeDate: Date,
  calendar: HolidayCalendar,
): Date => addKrxTradingDays(tradeDate, SETTLEMENT_TRADING_DAYS, calendar);
