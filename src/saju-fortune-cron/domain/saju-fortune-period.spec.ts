import {
  monthPeriodOf,
  recentMissionPeriodOf,
  weekPeriodOf,
} from './saju-fortune-period';

describe('사주 하루 기록 조회 기간', () => {
  it('최근 미션은 오늘을 빼고 그 앞 14일', () => {
    expect(recentMissionPeriodOf({ today: '2026-11-10' })).toEqual({
      from: '2026-10-27',
      until: '2026-11-10',
    });
  });

  it.each([
    ['2026-11-09', '2026-11-09'], // 월요일
    ['2026-11-10', '2026-11-09'], // 화요일
    ['2026-11-15', '2026-11-09'], // 일요일
  ])('%s 가 속한 주는 %s(월)부터 다음 월요일 전까지', (date, monday) => {
    expect(weekPeriodOf({ date })).toEqual({
      from: monday,
      until: '2026-11-16',
    });
  });

  it('그달은 1일부터 다음 달 1일 전까지', () => {
    expect(monthPeriodOf({ date: '2026-11-10' })).toEqual({
      from: '2026-11-01',
      until: '2026-12-01',
    });
  });

  it('12월의 다음 달은 이듬해 1월', () => {
    expect(monthPeriodOf({ date: '2026-12-31' })).toEqual({
      from: '2026-12-01',
      until: '2027-01-01',
    });
  });
});
