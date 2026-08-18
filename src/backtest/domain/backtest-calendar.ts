export interface BuildBacktestCalendarInput {
  from: string;
  to: string;
  // DailyPrice 에 행이 존재하는 날짜들. 휴장일은 애초에 없으므로 별도 공휴일 달력이 필요 없다.
  tradeDates: string[];
}

export interface BacktestCalendar {
  // 추천 크론이 평일마다 도는 것을 그대로 재현한다. 공휴일에도 추천은 생성된다.
  recommendDates: string[];
  // 체결은 봉이 있는 날에만 성사된다.
  tradeDates: string[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const assertDateText = (value: string, label: string): void => {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(
      `${label}는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${value}`,
    );
  }
};

const isWeekend = (dateText: string): boolean => {
  const day = new Date(`${dateText}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
};

// 문자열 비교(>=, <=, sort)를 쓰는 이유는 YYYY-MM-DD 가 사전순과 시간순이 일치하기 때문이다.
// 형식 검증을 먼저 통과시키므로 안전하다.
export const buildBacktestCalendar = (
  input: BuildBacktestCalendarInput,
): BacktestCalendar => {
  assertDateText(input.from, 'from');
  assertDateText(input.to, 'to');
  if (input.from > input.to) {
    throw new Error(
      `from 이 to 보다 뒤일 수 없습니다. from: ${input.from}, to: ${input.to}`,
    );
  }

  const recommendDates: string[] = [];
  const cursor = new Date(`${input.from}T00:00:00.000Z`);
  const last = new Date(`${input.to}T00:00:00.000Z`);
  while (cursor.getTime() <= last.getTime()) {
    const dateText = cursor.toISOString().slice(0, 10);
    if (!isWeekend(dateText)) {
      recommendDates.push(dateText);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const tradeDates = [...new Set(input.tradeDates)]
    .filter((dateText) => dateText >= input.from && dateText <= input.to)
    .sort();

  return { recommendDates, tradeDates };
};
