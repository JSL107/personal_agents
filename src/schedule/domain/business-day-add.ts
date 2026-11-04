import {
  addDays,
  plainDateToIso,
  plainDateToUtcDate,
  todayInKst,
} from '../../agent/vacation/domain/plain-date';
import {
  holidayCalendarOf,
  isPublicBusinessDay,
} from '../../holiday/domain/business-calendar';
import { kstStartOfDay } from './parse-due-date';
import { PlainDate } from './schedule.type';

export const computeCandidateExpiresAt = (
  createdAt: Date,
  isHoliday: (date: PlainDate) => boolean,
): Date => {
  let cursor = todayInKst(createdAt);
  let elapsedBusinessDays = 0;
  while (elapsedBusinessDays < 3) {
    cursor = addDays(cursor, 1);
    const calendar = holidayCalendarOf(
      isHoliday(cursor) ? [plainDateToIso(cursor)] : [],
    );
    if (isPublicBusinessDay(plainDateToUtcDate(cursor), calendar)) {
      elapsedBusinessDays += 1;
    }
  }
  const nextDay = addDays(cursor, 1);
  return kstStartOfDay(nextDay);
};
