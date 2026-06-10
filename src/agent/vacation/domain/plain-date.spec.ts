import {
  addDays,
  addYears,
  comparePlainDate,
  dayOfWeek,
  monthsElapsed,
  parsePlainDate,
  plainDateToIso,
  plainDateToUtcDate,
  utcDateToPlainDate,
  yearsElapsed,
} from './plain-date';

describe('plain-date', () => {
  describe('parsePlainDate', () => {
    it('YYYY-MM-DD 를 PlainDate 로 파싱', () => {
      expect(parsePlainDate('2026-07-01')).toEqual({
        year: 2026,
        month: 7,
        day: 1,
      });
    });
    it('공백 trim 후 파싱', () => {
      expect(parsePlainDate('  2026-07-01 ')).toEqual({
        year: 2026,
        month: 7,
        day: 1,
      });
    });
    it('형식 불일치는 null', () => {
      expect(parsePlainDate('2026/07/01')).toBeNull();
      expect(parsePlainDate('26-7-1')).toBeNull();
      expect(parsePlainDate('hello')).toBeNull();
    });
    it('달력상 불가능한 날짜는 null (2026-02-30)', () => {
      expect(parsePlainDate('2026-02-30')).toBeNull();
      expect(parsePlainDate('2026-13-01')).toBeNull();
    });
    it('윤년 2024-02-29 는 유효', () => {
      expect(parsePlainDate('2024-02-29')).toEqual({
        year: 2024,
        month: 2,
        day: 29,
      });
    });
    it('평년 2026-02-29 는 null', () => {
      expect(parsePlainDate('2026-02-29')).toBeNull();
    });
  });

  it('plainDateToIso 는 zero-pad', () => {
    expect(plainDateToIso({ year: 2026, month: 7, day: 1 })).toBe('2026-07-01');
  });

  it('comparePlainDate', () => {
    expect(
      comparePlainDate(
        { year: 2026, month: 1, day: 1 },
        { year: 2026, month: 1, day: 2 },
      ),
    ).toBe(-1);
    expect(
      comparePlainDate(
        { year: 2026, month: 1, day: 2 },
        { year: 2026, month: 1, day: 1 },
      ),
    ).toBe(1);
    expect(
      comparePlainDate(
        { year: 2026, month: 1, day: 1 },
        { year: 2026, month: 1, day: 1 },
      ),
    ).toBe(0);
  });

  describe('addYears (월말 clamp)', () => {
    it('일반 가산', () => {
      expect(addYears({ year: 2024, month: 1, day: 15 }, 1)).toEqual({
        year: 2025,
        month: 1,
        day: 15,
      });
    });
    it('윤년 02-29 + 1년 → 평년 02-28 clamp', () => {
      expect(addYears({ year: 2024, month: 2, day: 29 }, 1)).toEqual({
        year: 2025,
        month: 2,
        day: 28,
      });
    });
  });

  describe('addDays', () => {
    it('월 경계 넘김', () => {
      expect(addDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
        year: 2026,
        month: 2,
        day: 1,
      });
    });
    it('음수 가산 (회기끝 = +1년 -1일)', () => {
      expect(addDays({ year: 2025, month: 1, day: 15 }, -1)).toEqual({
        year: 2025,
        month: 1,
        day: 14,
      });
    });
  });

  describe('monthsElapsed (만 경과 개월)', () => {
    it('같은 날 = 0', () => {
      expect(
        monthsElapsed(
          { year: 2024, month: 1, day: 15 },
          { year: 2024, month: 1, day: 15 },
        ),
      ).toBe(0);
    });
    it('만 1개월 직전 = 0', () => {
      expect(
        monthsElapsed(
          { year: 2024, month: 1, day: 15 },
          { year: 2024, month: 2, day: 14 },
        ),
      ).toBe(0);
    });
    it('만 1개월 당일 = 1', () => {
      expect(
        monthsElapsed(
          { year: 2024, month: 1, day: 15 },
          { year: 2024, month: 2, day: 15 },
        ),
      ).toBe(1);
    });
    it('만 28개월', () => {
      expect(
        monthsElapsed(
          { year: 2024, month: 1, day: 15 },
          { year: 2026, month: 6, day: 10 },
        ),
      ).toBe(28);
    });
    it('말일 입사 01-31 → 02-29(윤년 말일)은 만 1개월', () => {
      expect(monthsElapsed({ year: 2024, month: 1, day: 31 }, { year: 2024, month: 2, day: 29 })).toBe(1);
    });
    it('말일 입사 01-31 → 02-28(윤년, 말일 아님)은 만 0개월', () => {
      expect(monthsElapsed({ year: 2024, month: 1, day: 31 }, { year: 2024, month: 2, day: 28 })).toBe(0);
    });
    it('윤년 입사 02-29 → 다음해 02-28(평년 말일)은 만 12개월', () => {
      expect(monthsElapsed({ year: 2024, month: 2, day: 29 }, { year: 2025, month: 2, day: 28 })).toBe(12);
    });
    it('기존 케이스 회귀: 만 28개월 유지', () => {
      expect(monthsElapsed({ year: 2024, month: 1, day: 15 }, { year: 2026, month: 6, day: 10 })).toBe(28);
    });
  });

  describe('yearsElapsed (만 경과 연수)', () => {
    it('만 1년 직전 = 0', () => {
      expect(
        yearsElapsed(
          { year: 2024, month: 1, day: 15 },
          { year: 2025, month: 1, day: 14 },
        ),
      ).toBe(0);
    });
    it('만 1년 당일 = 1', () => {
      expect(
        yearsElapsed(
          { year: 2024, month: 1, day: 15 },
          { year: 2025, month: 1, day: 15 },
        ),
      ).toBe(1);
    });
    it('만 2년 경과', () => {
      expect(
        yearsElapsed(
          { year: 2024, month: 1, day: 15 },
          { year: 2026, month: 6, day: 10 },
        ),
      ).toBe(2);
    });
  });

  describe('dayOfWeek (0=일 … 6=토)', () => {
    it('2026-06-10 은 수요일(3)', () => {
      expect(dayOfWeek({ year: 2026, month: 6, day: 10 })).toBe(3);
    });
    it('2026-06-13 은 토요일(6)', () => {
      expect(dayOfWeek({ year: 2026, month: 6, day: 13 })).toBe(6);
    });
    it('2026-06-14 은 일요일(0)', () => {
      expect(dayOfWeek({ year: 2026, month: 6, day: 14 })).toBe(0);
    });
  });

  describe('Prisma Date 변환 (UTC 자정 고정)', () => {
    it('plainDateToUtcDate → utcDateToPlainDate 왕복', () => {
      const pd = { year: 2026, month: 7, day: 1 };
      const date = plainDateToUtcDate(pd);
      expect(date.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(utcDateToPlainDate(date)).toEqual(pd);
    });
  });
});
