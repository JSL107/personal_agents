import { dayPillarOf } from '../domain/day-pillar';
import { analyzeSajuDay } from '../domain/saju-analysis';
import { weeklyScoresOf } from './weekly-scores';
import { yearMonthPillarsOf } from './year-month-pillar';

describe('weeklyScoresOf', () => {
  const natalPillars = ['丙寅', '辛卯', '壬戌', '庚子'];

  it('월~일 7일의 별점이 그날 일일 운세 별점과 같다', () => {
    const week = weeklyScoresOf({ natalPillars, mondayKst: '2026-11-16' });

    expect(week.map(({ weekday }) => weekday)).toEqual([
      '월',
      '화',
      '수',
      '목',
      '금',
      '토',
      '일',
    ]);
    expect(week.map(({ date }) => date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    week.forEach(({ date, scores }) => {
      const daily = analyzeSajuDay({
        natalPillars,
        todayPillar: dayPillarOf(date),
        yearMonthPillars: yearMonthPillarsOf(date),
      });
      expect(scores).toEqual(daily.scores);
    });
  });
});
