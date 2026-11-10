import {
  addDaysTo,
  formatKstDate,
  formatKstDateTime,
  formatKstIsoDateTime,
  getKstDayStartAsUtc,
  getTodayKstDate,
  isCalendarDate,
  kstDayStartOf,
  mondayOf,
  nextMonthStartOf,
  utcMidnightOf,
  weekdayOf,
} from './kst-date.util';

describe('formatKstDate', () => {
  it('UTC 16시는 KST 자정 이후이므로 다음 KST 날짜를 반환한다', () => {
    expect(formatKstDate('2026-08-10T16:00:00Z')).toBe('2026-08-11');
  });

  it('UTC 14:59:59는 KST 자정 전이므로 같은 KST 날짜를 반환한다', () => {
    expect(formatKstDate('2026-08-10T14:59:59Z')).toBe('2026-08-10');
  });

  it('파싱할 수 없는 입력은 null을 반환한다', () => {
    expect(formatKstDate('not-a-date')).toBeNull();
  });

  it('new Date(null)가 epoch로 해석되는 회귀를 막고 null을 반환한다', () => {
    expect(formatKstDate(null)).toBeNull();
  });

  it.each([undefined, '', '   '])(
    '값이 없거나 공백뿐인 입력 %p은 null을 반환한다',
    (value) => {
      expect(formatKstDate(value)).toBeNull();
    },
  );
});

describe('getTodayKstDate', () => {
  it('YYYY-MM-DD ISO 8601 형식 반환', () => {
    expect(getTodayKstDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Asia/Seoul timezone 기준 — UTC 와 다른 day 일 수 있음', () => {
    // 본 환경 timezone 무관 — 결과가 KST 기준 오늘. 길이/형식만 검증.
    const result = getTodayKstDate();
    expect(result).toHaveLength(10);
    const [year, month, day] = result.split('-').map(Number);
    expect(year).toBeGreaterThanOrEqual(2026);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});

describe('getKstDayStartAsUtc', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T16:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('daysAgo=0 이면 오늘 KST 00:00 을 UTC instant 로 반환한다', () => {
    const result = getKstDayStartAsUtc(0);

    expect(result.toISOString()).toBe('2026-07-07T15:00:00.000Z');
  });

  it('daysAgo=6 이면 6일 전 KST 00:00 을 UTC instant 로 반환한다', () => {
    const result = getKstDayStartAsUtc(6);

    expect(result.toISOString()).toBe('2026-07-01T15:00:00.000Z');
  });

  it('KST midnight changes at 15:00 UTC', () => {
    expect(
      getKstDayStartAsUtc(
        0,
        new Date('2026-10-14T14:59:59Z').getTime(),
      ).toISOString(),
    ).toBe('2026-10-13T15:00:00.000Z');
    expect(
      getKstDayStartAsUtc(
        0,
        new Date('2026-10-14T15:00:00Z').getTime(),
      ).toISOString(),
    ).toBe('2026-10-14T15:00:00.000Z');
  });
});

describe('formatKstDateTime', () => {
  it('UTC 시각을 KST 날짜·24시간 시각으로 바꾼다', () => {
    expect(formatKstDateTime(new Date('2026-10-29T23:05:00Z'))).toBe(
      '2026-10-30 08:05',
    );
  });
  it('자정은 00 시로 쓴다', () => {
    expect(formatKstDateTime(new Date('2026-10-29T15:00:00Z'))).toBe(
      '2026-10-30 00:00',
    );
  });
});

describe('utcMidnightOf / kstDayStartOf', () => {
  const INPUTS = [
    '2026-01-01',
    '2025-12-31',
    '2028-02-29',
    '2023-02-29',
    '2026-02-30',
    '2026-13-01',
    '0000-01-01',
    '9999-12-31',
    '+002026-01-01',
    '2026',
    '2026-01',
    '2026-1-1',
    ' 2026-01-01',
    '',
    'abc',
  ];
  it.each(INPUTS)('utcMidnightOf(%p) 는 원래 인라인 식과 같다', (input) => {
    const actual = utcMidnightOf(input).getTime();
    expect(
      Object.is(actual, new Date(`${input}T00:00:00.000Z`).getTime()),
    ).toBe(true);
    expect(Object.is(actual, new Date(`${input}T00:00:00Z`).getTime())).toBe(
      true,
    );
    expect(Object.is(actual, Date.parse(`${input}T00:00:00Z`))).toBe(true);
  });
  it.each(INPUTS)('kstDayStartOf(%p) 는 원래 인라인 식과 같다', (input) => {
    const actual = kstDayStartOf(input).getTime();
    expect(
      Object.is(actual, new Date(`${input}T00:00:00+09:00`).getTime()),
    ).toBe(true);
    expect(
      Object.is(actual, new Date(`${input}T00:00:00.000+09:00`).getTime()),
    ).toBe(true);
  });
  it('UTC 자정과 KST 0시를 돌려준다', () => {
    expect(utcMidnightOf('2026-01-01').toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(kstDayStartOf('2026-01-01').toISOString()).toBe(
      '2025-12-31T15:00:00.000Z',
    );
    expect(
      utcMidnightOf('2026-11-05').getTime() -
        kstDayStartOf('2026-11-05').getTime(),
    ).toBe(32_400_000);
  });
  it('잘못된 입력에서 던지지 않고 Invalid Date 를 돌려준다', () => {
    expect(Number.isNaN(utcMidnightOf('abc').getTime())).toBe(true);
    expect(Number.isNaN(kstDayStartOf('abc').getTime())).toBe(true);
    expect(() => utcMidnightOf('abc').toISOString()).toThrow(RangeError);
    expect(() => kstDayStartOf('abc').toISOString()).toThrow(RangeError);
  });
});

describe('weekdayOf', () => {
  it.each([
    ['2026-11-16', 1],
    ['2026-11-22', 0],
  ])('%s → %i', (date, expected) => {
    expect(weekdayOf(date)).toBe(expected);
  });
});

describe('addDaysTo', () => {
  it('연말을 넘긴다', () => {
    expect(addDaysTo('2026-12-28', 6)).toBe('2027-01-03');
  });
});

describe('formatKstIsoDateTime', () => {
  it('UTC 시각을 KST 오프셋 ISO 로 바꾼다', () => {
    expect(formatKstIsoDateTime(new Date('2026-11-08T15:00:00Z'))).toBe(
      '2026-11-09T00:00:00+09:00',
    );
  });
});

describe('mondayOf', () => {
  it.each([
    ['2026-11-09', '2026-11-09'], // 월
    ['2026-11-10', '2026-11-09'], // 화
    ['2026-11-15', '2026-11-09'], // 일
    ['2027-01-01', '2026-12-28'], // 해를 넘긴다
  ])('%s 가 속한 주의 월요일은 %s', (date, monday) => {
    expect(mondayOf(date)).toBe(monday);
  });
});

describe('nextMonthStartOf', () => {
  it.each([
    ['2026-11-10', '2026-12-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-29', '2028-03-01'],
    // 두 자리 연도를 1900년대로 바꾸지 않는다.
    ['0050-12-15', '0051-01-01'],
    ['0099-03-03', '0099-04-01'],
  ])('%s 의 다음 달 1일은 %s', (date, nextMonthStart) => {
    expect(nextMonthStartOf(date)).toBe(nextMonthStart);
  });
});

describe('isCalendarDate', () => {
  it.each([
    ['2026-11-10', true],
    ['2028-02-29', true],
    ['2027-02-29', false],
    ['2026-02-30', false],
    ['2026/11/10', false],
    ['', false],
  ])('%p → %p', (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected);
  });
});
