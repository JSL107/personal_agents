const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 서버 timezone (UTC 가능) 과 무관하게 KST 기준 YYYY-MM-DD 반환.
// en-CA 로케일은 ISO 8601 ("2026-05-29") 형식을 그대로 출력 — 별도 padding 없음.
// Daily Eval / Impact Report Cron 등 cron consumer 의 Slack 헤더 날짜 표기 공통 유틸.
export const getTodayKstDate = (): string =>
  KST_DATE_FORMATTER.format(new Date());

// ISO 8601 시각을 KST 캘린더 날짜로 변환한다. fallback 문구는 caller가 결정할 수 있도록
// 파싱할 수 없는 값에는 null을 반환한다.
export const formatKstDate = (
  isoDateTime: string | null | undefined,
): string | null => {
  // new Date(null)는 epoch가 되어 NaN 검사만으로는 결측 날짜를 막을 수 없다.
  if (!isoDateTime || isoDateTime.trim().length === 0) {
    return null;
  }
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return KST_DATE_FORMATTER.format(date);
};

// Date 의 KST 달력일(YYYY-MM-DD). Date 를 받으므로 formatKstDate 의 파싱 실패 분기가 없다.
export const getKstDateOf = (date: Date): string =>
  KST_DATE_FORMATTER.format(date);

const KST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Date 의 KST 시각(YYYY-MM-DD HH:mm). 모델 프롬프트에 싣는 기록 줄처럼 날짜와 시각이 함께 필요할 때 쓴다.
export const formatKstDateTime = (date: Date): string =>
  KST_DATE_TIME_FORMATTER.format(date).replace(', ', ' ');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// KST 기준 (오늘 - daysAgo) 일의 00:00 을 가리키는 UTC Date.
// 서버 timezone 과 무관하게 KST 캘린더일 필터 경계를 만든다. now 는 기준 시각(기본 현재).
export const getKstDayStartAsUtc = (
  daysAgo = 0,
  now: number = Date.now(),
): Date => {
  const kstNow = new Date(now + KST_OFFSET_MS);
  const kstMidnightAsUtcTs = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate() - daysAgo,
  );
  return new Date(kstMidnightAsUtcTs - KST_OFFSET_MS);
};

// 두 시각 사이의 KST 캘린더일 차이. 같은 날이면 0, 어제 → 오늘이면 1.
// 시각 차(24시간)가 아니라 자정 경계를 세는 것이 요점이다 — 저녁 23시 회고와 다음 날 아침 9시
// 브리핑은 10시간 차이지만 사용자에게는 "어제 것" 이고, 그 표현이 모델에게 필요한 값이다.
export const countKstDaysBetween = (from: Date, to: Date): number => {
  const toKstDayIndex = (date: Date): number =>
    Math.floor((date.getTime() + KST_OFFSET_MS) / DAY_MS);
  return toKstDayIndex(to) - toKstDayIndex(from);
};

// 'YYYY-MM-DD' 문자열 → 그날 UTC 00:00. 지금 시각 기준이 아니다.
// @db.Date 값·getUTCDay·날짜 차이처럼 "날짜만" 담을 때 쓴다. 검증하지 않는다 — 잘못된 입력은 Invalid Date.
export const utcMidnightOf = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`);

// 'YYYY-MM-DD' 문자열 → 그날 KST 00:00 의 실제 시각(전날 15:00Z). 지금 시각 기준이 아니다.
// 조회 범위 경계처럼 "그날 한국 시간 0시" 가 필요할 때 쓴다. 검증하지 않는다 — 잘못된 입력은 Invalid Date.
export const kstDayStartOf = (date: string): Date =>
  new Date(`${date}T00:00:00+09:00`);

// 'YYYY-MM-DD' 의 요일(0=일 … 6=토). 서버 시간대와 무관하게 날짜만으로 본다.
export const weekdayOf = (date: string): number =>
  utcMidnightOf(date).getUTCDay();

// 'YYYY-MM-DD' 에 days 일을 더한 'YYYY-MM-DD'. 월·연 경계를 넘겨도 달력대로 간다.
export const addDaysTo = (date: string, days: number): string => {
  const shifted = new Date(utcMidnightOf(date).getTime() + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
};

// Date → KST 오프셋을 붙인 ISO 시각('2026-11-09T00:00:00+09:00'). 초 단위까지만 남긴다.
// 외부 프로세스·API 에 KST 기준 경계를 그대로 넘길 때 쓴다.
export const formatKstIsoDateTime = (date: Date): string => {
  const kstClock = new Date(date.getTime() + KST_OFFSET_MS);
  const dateTime = kstClock.toISOString().slice(0, 19);
  return `${dateTime}+09:00`;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_PER_WEEK = 7;

// 'YYYY-MM-DD' 가 달력에 있는 날인지(2026-02-30·2027-02-29 는 아니다). 밖에서 들어온 날짜 문자열 검증용.
export const isCalendarDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const date = utcMidnightOf(value);
  const valid =
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  return valid;
};

// 'YYYY-MM-DD' 가 속한 주(월~일)의 월요일.
export const mondayOf = (date: string): string => {
  const daysSinceMonday = (weekdayOf(date) + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
  const monday = addDaysTo(date, -daysSinceMonday);
  return monday;
};

// 'YYYY-MM-DD' 가 속한 달의 다음 달 1일. 12월이면 이듬해 1월 1일.
export const nextMonthStartOf = (date: string): string => {
  // Date.UTC 는 0~99년을 1900~1999년으로 바꾸므로 Date 없이 연·월만 올린다.
  const [year, month] = date.split('-').map(Number);
  const isDecember = month === 12;
  const nextYear = isDecember ? year + 1 : year;
  const nextMonth = isDecember ? 1 : month + 1;
  const nextMonthStart = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  return nextMonthStart;
};
