import { PlainDate } from './schedule.type';

const KST_OFFSET_MINUTES = 9 * 60;
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const ABSOLUTE_ISO = /(\d{4})-(\d{1,2})-(\d{1,2})/;
const ABSOLUTE_KO = /(\d{1,2})월\s*(\d{1,2})일/;
const MONTH_END_KO = /(\d{1,2})월\s*말/;
const NEXT_WEEKDAY_KO = /다음\s*주\s*([일월화수목금토])요일/;
const THIS_WEEKDAY_KO = /이번\s*주\s*([일월화수목금토])요일/;

// 날짜 산술은 UTC 자정 기준 Date 로만 한다. 로컬 타임존이 끼면 하루가 밀린다.
export const plainDateToUtcDate = (date: PlainDate): Date => {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
};

const utcDateToPlain = (date: Date): PlainDate => {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

// JS Date 는 2월 30일을 3월 2일로 조용히 넘긴다. 넣은 값이 그대로 나오는지 대조해 걸러낸다.
const isRealDate = (date: PlainDate): boolean => {
  if (date.month < 1 || date.month > 12 || date.day < 1) {
    return false;
  }
  const candidate = plainDateToUtcDate(date);
  return (
    candidate.getUTCFullYear() === date.year &&
    candidate.getUTCMonth() + 1 === date.month &&
    candidate.getUTCDate() === date.day
  );
};

const addDays = (base: PlainDate, days: number): PlainDate => {
  const shifted = plainDateToUtcDate(base);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return utcDateToPlain(shifted);
};

export const todayInKst = (now: Date): PlainDate => {
  const shifted = new Date(now.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  return utcDateToPlain(shifted);
};

// 월/일만 주어졌을 때 올해로 두면 이미 지난 날짜가 된다. 마감은 앞을 보는 값이므로 내년으로 민다.
const resolveYear = (month: number, day: number, today: PlainDate): number => {
  const thisYear = { year: today.year, month, day };
  if (!isRealDate(thisYear)) {
    return today.year;
  }
  const isPast =
    plainDateToUtcDate(thisYear).getTime() <
    plainDateToUtcDate(today).getTime();
  return isPast ? today.year + 1 : today.year;
};

const parseWeekday = (
  text: string,
  today: PlainDate,
  weekOffset: number,
): PlainDate | null => {
  const pattern = weekOffset === 1 ? NEXT_WEEKDAY_KO : THIS_WEEKDAY_KO;
  const matched = text.match(pattern);
  if (!matched) {
    return null;
  }
  const targetWeekday = WEEKDAY_NAMES.indexOf(matched[1]);
  const currentWeekday = plainDateToUtcDate(today).getUTCDay();
  // 월요일을 주의 시작으로 본다. 일요일(0)을 7로 옮겨 계산한다.
  const normalizedCurrent = currentWeekday === 0 ? 7 : currentWeekday;
  const normalizedTarget = targetWeekday === 0 ? 7 : targetWeekday;
  const daysToMonday = 1 - normalizedCurrent;
  const offset = daysToMonday + weekOffset * 7 + (normalizedTarget - 1);
  // 마감은 과거가 될 수 없다. "이번주 월요일" 을 금요일에 물으면 4일 전이 나오는데,
  // 그 의도가 지난 월요일인지 다음 월요일인지 알 수 없으므로 추측하지 않고 되묻는다.
  if (offset < 0) {
    return null;
  }
  return addDays(today, offset);
};

export const parseDueDate = (
  text: string,
  today: PlainDate,
): PlainDate | null => {
  const isoMatched = text.match(ABSOLUTE_ISO);
  if (isoMatched) {
    const candidate = {
      year: Number(isoMatched[1]),
      month: Number(isoMatched[2]),
      day: Number(isoMatched[3]),
    };
    return isRealDate(candidate) ? candidate : null;
  }

  const monthEndMatched = text.match(MONTH_END_KO);
  if (monthEndMatched) {
    const month = Number(monthEndMatched[1]);
    if (month < 1 || month > 12) {
      return null;
    }
    // 연도는 그 달의 **말일** 기준으로 정한다. 1일 기준으로 정하면 이번 달 안에 있어도
    // 이미 지난 날로 판정돼 내년으로 밀린다("9월 말" 을 9월 18일에 물으면 2027년이 됐다).
    const tentativeLastDay = new Date(
      Date.UTC(today.year, month, 0),
    ).getUTCDate();
    const year = resolveYear(month, tentativeLastDay, today);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { year, month, day: lastDay };
  }

  const koreanMatched = text.match(ABSOLUTE_KO);
  if (koreanMatched) {
    const month = Number(koreanMatched[1]);
    const day = Number(koreanMatched[2]);
    const candidate = { year: resolveYear(month, day, today), month, day };
    return isRealDate(candidate) ? candidate : null;
  }

  if (text.includes('모레')) {
    return addDays(today, 2);
  }
  if (text.includes('내일')) {
    return addDays(today, 1);
  }
  if (text.includes('오늘')) {
    return today;
  }

  const nextWeekday = parseWeekday(text, today, 1);
  if (nextWeekday) {
    return nextWeekday;
  }
  return parseWeekday(text, today, 0);
};
