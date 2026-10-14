import { holidayCalendarOf } from '../../holiday/domain/business-calendar';
import { addPublicBusinessDays } from './idea-due-date';

describe('addPublicBusinessDays', () => {
  it('금요일 다음 1영업일은 월요일이다', () => {
    const result = addPublicBusinessDays(
      { year: 2026, month: 10, day: 16 },
      1,
      holidayCalendarOf([]),
    );
    expect(result).toEqual({ year: 2026, month: 10, day: 19 });
  });

  it('공휴일을 건너뛰어 3영업일을 계산한다', () => {
    const result = addPublicBusinessDays(
      new Date('2026-10-16T00:00:00.000Z'),
      3,
      holidayCalendarOf(['2026-10-19']),
    );
    expect(result).toEqual({ year: 2026, month: 10, day: 22 });
  });

  it('연휴를 건너뛰어 5영업일을 계산한다', () => {
    const result = addPublicBusinessDays(
      { year: 2026, month: 10, day: 16 },
      5,
      holidayCalendarOf(['2026-10-19', '2026-10-20']),
    );
    expect(result).toEqual({ year: 2026, month: 10, day: 27 });
  });
});
