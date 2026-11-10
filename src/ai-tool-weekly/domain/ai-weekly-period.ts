import {
  addDaysTo,
  kstDayStartOf,
  weekdayOf,
} from '../../common/util/kst-date.util';

export interface AiWeeklyPeriod {
  since: Date;
  until: Date;
  prevSince: Date;
}

// firedAtKst('YYYY-MM-DD') 이하에서 가장 가까운 월요일 KST 0시를 until 로 잡는다. since 는 그 7일 전.
export const resolveAiWeeklyPeriod = (firedAtKst: string): AiWeeklyPeriod => {
  const daysSinceMonday = (weekdayOf(firedAtKst) + 6) % 7;
  const untilDate = addDaysTo(firedAtKst, -daysSinceMonday);
  const since = kstDayStartOf(addDaysTo(untilDate, -7));
  const prevSince = kstDayStartOf(addDaysTo(untilDate, -14));
  const until = kstDayStartOf(untilDate);
  return { since, until, prevSince };
};
