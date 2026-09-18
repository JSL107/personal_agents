import { ScheduleItemRecord, ScheduleStatus } from './schedule.type';

const DAY_MS = 24 * 60 * 60 * 1000;

const toDayLabel = (dueDate: Date, today: Date): string => {
  const remaining = Math.round((dueDate.getTime() - today.getTime()) / DAY_MS);
  if (remaining === 0) {
    return 'D-day';
  }
  if (remaining < 0) {
    return `D+${Math.abs(remaining)}`;
  }
  return `D-${remaining}`;
};

export const formatUpcomingLine = (
  items: ScheduleItemRecord[],
  today: Date,
): string => {
  const open = items.filter((item) => item.status === ScheduleStatus.OPEN);
  if (open.length === 0) {
    return '';
  }
  const parts = open.map((item) => {
    return `${item.title}(${toDayLabel(item.dueDate, today)})`;
  });
  return `\n📌 다가오는 마감 — ${parts.join(' · ')}`;
};
