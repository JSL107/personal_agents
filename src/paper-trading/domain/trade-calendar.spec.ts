import { nextWeekday } from './trade-calendar';

describe('nextWeekday', () => {
  it.each([
    ['금요일', '2026-08-14', '2026-08-17'],
    ['토요일', '2026-08-15', '2026-08-17'],
    ['일요일', '2026-08-16', '2026-08-17'],
  ])('%s에는 다음 월요일을 반환한다', (_label, currentDate, expected) => {
    expect(nextWeekday(new Date(`${currentDate}T12:00:00.000Z`))).toEqual(
      new Date(`${expected}T00:00:00.000Z`),
    );
  });

  it('평일에는 바로 다음 날을 반환한다', () => {
    expect(nextWeekday(new Date('2026-08-18T12:00:00.000Z'))).toEqual(
      new Date('2026-08-19T00:00:00.000Z'),
    );
  });
});
