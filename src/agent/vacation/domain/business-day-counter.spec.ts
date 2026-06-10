import { countBusinessDays, NoopHolidayProvider } from './business-day-counter';
import { VacationException } from './vacation.exception';
import { VacationErrorCode } from './vacation-error-code.enum';

describe('countBusinessDays', () => {
  const holidays = new NoopHolidayProvider();

  it('평일 단일일 = 1 (2026-06-10 수)', () => {
    expect(
      countBusinessDays(
        { year: 2026, month: 6, day: 10 },
        { year: 2026, month: 6, day: 10 },
        holidays,
      ),
    ).toBe(1);
  });
  it('주말 단일일 = 0 (2026-06-13 토)', () => {
    expect(
      countBusinessDays(
        { year: 2026, month: 6, day: 13 },
        { year: 2026, month: 6, day: 13 },
        holidays,
      ),
    ).toBe(0);
  });
  it('수~금 = 3', () => {
    expect(
      countBusinessDays(
        { year: 2026, month: 6, day: 10 },
        { year: 2026, month: 6, day: 12 },
        holidays,
      ),
    ).toBe(3);
  });
  it('금~다음주 화 = 평일 3 (금 + 월 + 화, 토일 제외)', () => {
    expect(
      countBusinessDays(
        { year: 2026, month: 6, day: 12 },
        { year: 2026, month: 6, day: 16 },
        holidays,
      ),
    ).toBe(3);
  });
  it('start > end 면 VacationException(INVALID_DATE_RANGE)', () => {
    expect(() =>
      countBusinessDays(
        { year: 2026, month: 6, day: 12 },
        { year: 2026, month: 6, day: 10 },
        holidays,
      ),
    ).toThrow(VacationException);
    try {
      countBusinessDays(
        { year: 2026, month: 6, day: 12 },
        { year: 2026, month: 6, day: 10 },
        holidays,
      );
    } catch (error) {
      expect((error as VacationException).vacationErrorCode).toBe(
        VacationErrorCode.INVALID_DATE_RANGE,
      );
    }
  });
  it('HolidayProvider 가 true 인 날은 제외', () => {
    const onlyTenth = { isHoliday: (d: { day: number }) => d.day === 10 };
    expect(
      countBusinessDays(
        { year: 2026, month: 6, day: 10 },
        { year: 2026, month: 6, day: 12 },
        onlyTenth,
      ),
    ).toBe(2);
  });
});
