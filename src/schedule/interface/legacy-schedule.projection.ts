import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';

export const projectItemForLegacy = (
  item: ScheduleItemRecord,
): ScheduleItemRecord => {
  if (item.status === ScheduleStatus.IN_PROGRESS) {
    return { ...item, status: ScheduleStatus.OPEN };
  }
  return item;
};

export const projectForLegacy = (
  items: ScheduleItemRecord[],
): ScheduleItemRecord[] => {
  return items
    .filter(
      (item) =>
        item.dueDate !== null && item.status !== ScheduleStatus.CANDIDATE,
    )
    .map(projectItemForLegacy);
};
