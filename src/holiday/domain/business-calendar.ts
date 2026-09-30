// 영업일 판정의 단일 출처. 날짜는 전부 "그 날짜의 UTC 자정" 인 `Date` 로 다룬다 —
// 원장의 `@db.Date` 컬럼(`trade_date`·`target_trade_date`)이 그렇게 읽히고 쓰이기 때문이다.
//
// 두 가지 달력이 있다.
// - 공휴일 달력(`isPublicBusinessDay`): 주말과 법정 공휴일만 쉰다. 휴가 일수가 쓴다.
// - KRX 달력(`isKrxTradingDay`): 공휴일 달력 + 연말 휴장일. 추천·청산·결제일·채점이 쓴다.
//
// 휴장일의 정본을 이렇게 잡은 근거(2026-09-30 실측): 2026-01-01~09-29 동안 국내 시세가 없는
// 평일 13일과 `schedule_item.is_holiday` 평일 13일이 1:1 로 일치했다. 공휴일 API 에 없는 KRX
// 고유 휴장은 연말 하루뿐이다 — 근로자의날은 2026년부터 법정 공휴일(노동절)이 되어 API 가 준다.
// 지나간 날짜의 개장 여부는 여전히 `daily_price` 행 존재가 정본이다. 이 달력은 행이 아직 없는
// 미래 날짜(다음 체결일·결제일)를 정하려고 있다.
export interface HolidayCalendar {
  // 공휴일 날짜(`YYYY-MM-DD`). 달력에 넣은 사람·완료 여부와 무관하게 전부 담는다.
  readonly holidayDates: ReadonlySet<string>;
}

export const holidayCalendarOf = (
  dates: Iterable<string>,
): HolidayCalendar => ({
  holidayDates: new Set(dates),
});

const DECEMBER = 11;
const LAST_DAY_OF_DECEMBER = 31;

const toDateText = (date: Date): string => date.toISOString().slice(0, 10);

// 시각을 떼고 그 날짜의 UTC 자정으로 맞춘다. 호출부가 넘기는 시각(추천 19:30 KST 등)과
// 무관하게 날짜 단위로만 비교하려는 것이다.
const startOfUtcDate = (date: Date): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

const shiftDays = (date: Date, days: number): Date => {
  const shifted = startOfUtcDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
};

const isWeekend = (date: Date): boolean =>
  date.getUTCDay() === 0 || date.getUTCDay() === 6;

export const isPublicBusinessDay = (
  date: Date,
  calendar: HolidayCalendar,
): boolean => !isWeekend(date) && !calendar.holidayDates.has(toDateText(date));

// KRX 연말 휴장일 = 12월의 마지막 평일 중 공휴일이 아닌 날. 31일이 주말이면 그 직전 평일이
// 쉰다(2022-12-30 금·2023-12-29 금 실측).
export const krxYearEndClosureOf = (
  year: number,
  calendar: HolidayCalendar,
): Date => {
  let cursor = new Date(Date.UTC(year, DECEMBER, LAST_DAY_OF_DECEMBER));
  while (!isPublicBusinessDay(cursor, calendar)) {
    cursor = shiftDays(cursor, -1);
  }
  return cursor;
};

export const isKrxTradingDay = (
  date: Date,
  calendar: HolidayCalendar,
): boolean => {
  if (!isPublicBusinessDay(date, calendar)) {
    return false;
  }
  if (date.getUTCMonth() !== DECEMBER) {
    return true;
  }
  return (
    toDateText(krxYearEndClosureOf(date.getUTCFullYear(), calendar)) !==
    toDateText(date)
  );
};

// 주어진 날짜 다음의 첫 거래일. 주어진 날짜가 거래일이어도 그 날은 포함하지 않는다.
export const nextKrxTradingDay = (
  date: Date,
  calendar: HolidayCalendar,
): Date => {
  let cursor = shiftDays(date, 1);
  while (!isKrxTradingDay(cursor, calendar)) {
    cursor = shiftDays(cursor, 1);
  }
  return cursor;
};

export const addKrxTradingDays = (
  date: Date,
  tradingDays: number,
  calendar: HolidayCalendar,
): Date => {
  let cursor = startOfUtcDate(date);
  for (let count = 0; count < tradingDays; count += 1) {
    cursor = nextKrxTradingDay(cursor, calendar);
  }
  return cursor;
};

// 주어진 날짜가 거래일이면 그 날, 아니면 직전 거래일.
export const latestKrxTradingDayOnOrBefore = (
  date: Date,
  calendar: HolidayCalendar,
): Date => {
  let cursor = startOfUtcDate(date);
  while (!isKrxTradingDay(cursor, calendar)) {
    cursor = shiftDays(cursor, -1);
  }
  return cursor;
};
