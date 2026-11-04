import { countKstDaysBetween } from '../../common/util/kst-date.util';
import { ScheduleItemRecord, ScheduleSource } from './schedule.type';

interface CountTrackedDaysInput {
  item: ScheduleItemRecord;
  now: Date;
}

export const countTrackedDays = ({
  item,
  now,
}: CountTrackedDaysInput): number => {
  const start =
    item.source === ScheduleSource.GITHUB_PR
      ? (item.startedAt ?? item.createdAt)
      : item.createdAt;
  return countKstDaysBetween(start, now) + 1;
};
