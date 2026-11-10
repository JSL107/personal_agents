import { dayPillarOf } from '../domain/day-pillar';
import { analyzeSajuDay } from '../domain/saju-analysis';
import { DailyScores, weekDatesFrom, WEEKDAYS } from '../domain/weekly-fortune';
import { yearMonthPillarsOf } from './year-month-pillar';

// 월요일부터 7일의 별점 — 일일 운세와 같은 입력(그날 일진·정오 대표 년·월주)으로 다시 계산해 저장하지 않는다.
// 아침 발송과 스레드 답이 함께 쓴다.
export const weeklyScoresOf = ({
  natalPillars,
  mondayKst,
}: {
  natalPillars: string[];
  mondayKst: string;
}): DailyScores[] => {
  const week = weekDatesFrom(mondayKst).map((date, index) => {
    const { scores } = analyzeSajuDay(
      natalPillars,
      dayPillarOf(date),
      yearMonthPillarsOf(date),
    );
    const day: DailyScores = { date, weekday: WEEKDAYS[index], scores };
    return day;
  });
  return week;
};
