// 시·분·초·timezone 을 다루지 않는 달력 날짜 값 타입.
// 레포에 date 라이브러리가 없어 Date 직접 사용 시 UTC/KST 오프셋으로 하루가 밀리는 함정을 피하기 위함.
export interface PlainDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const isRealDate = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  // UTC 로 만들어 month rollover 가 없으면 실제 존재하는 날짜.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

// 형식(YYYY-MM-DD) + 달력 유효성 검증. 어긋나면 null (호출자가 예외로 변환).
export const parsePlainDate = (text: string): PlainDate | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealDate(year, month, day)) {
    return null;
  }
  return { year, month, day };
};

export const plainDateToIso = ({ year, month, day }: PlainDate): string => {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
};

export const comparePlainDate = (a: PlainDate, b: PlainDate): -1 | 0 | 1 => {
  const left = a.year * 10000 + a.month * 100 + a.day;
  const right = b.year * 10000 + b.month * 100 + b.day;
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const lastDayOfMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

// 연 가산 + 월말 clamp (윤년 02-29 + 1년 → 평년 02-28).
export const addYears = (date: PlainDate, years: number): PlainDate => {
  const year = date.year + years;
  const day = Math.min(date.day, lastDayOfMonth(year, date.month));
  return { year, month: date.month, day };
};

// 일 가산 (음수 허용). UTC 기준으로 계산해 timezone 영향 제거.
export const addDays = (date: PlainDate, days: number): PlainDate => {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
};

// 만 경과 개월 수 (from 이후 to 까지 완전히 채운 개월). to < from 이면 0.
export const monthsElapsed = (from: PlainDate, to: PlainDate): number => {
  if (comparePlainDate(to, from) < 0) {
    return 0;
  }
  let months = (to.year - from.year) * 12 + (to.month - from.month);
  if (to.day < from.day) {
    months -= 1;
  }
  return Math.max(0, months);
};

// 만 경과 연수.
export const yearsElapsed = (from: PlainDate, to: PlainDate): number => {
  return Math.floor(monthsElapsed(from, to) / 12);
};

// 0=일요일 … 6=토요일. 요일만 필요하므로 UTC 사용 (timezone 무관).
export const dayOfWeek = ({ year, month, day }: PlainDate): number => {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

// Prisma @db.Date 저장용 — UTC 자정 Date.
export const plainDateToUtcDate = ({ year, month, day }: PlainDate): Date => {
  return new Date(Date.UTC(year, month - 1, day));
};

// Prisma @db.Date 조회 변환 — UTC 날짜 성분만 취함.
export const utcDateToPlainDate = (date: Date): PlainDate => {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

// KST(Asia/Seoul, UTC+9) 기준 오늘. asOf 를 주입받기 어려운 진입점에서만 사용.
export const todayInKst = (now: Date): PlainDate => {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
  };
};
