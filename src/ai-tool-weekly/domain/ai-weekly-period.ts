import { kstDayStartOf } from '../../common/util/kst-date.util';

export interface AiWeeklyPeriod {
  since: Date;
  until: Date;
  prevSince: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const resolveAiWeeklyPeriod = (firedAtKst: string): AiWeeklyPeriod => {
  const dayStart = kstDayStartOf(firedAtKst);
  const weekday = new Date(dayStart.getTime() + KST_OFFSET_MS).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const until = new Date(dayStart.getTime() - daysSinceMonday * DAY_MS);
  const since = new Date(until.getTime() - 7 * DAY_MS);
  const prevSince = new Date(since.getTime() - 7 * DAY_MS);
  return { since, until, prevSince };
};

export const toKstIso = (date: Date): string => {
  const local = new Date(date.getTime() + KST_OFFSET_MS);
  const value = local.toISOString().slice(0, 19);
  return `${value}+09:00`;
};
