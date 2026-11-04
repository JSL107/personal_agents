import { ScheduleItemRecord, ScheduleStatus } from './schedule.type';

export const buildScheduleItemRecord = (
  overrides: Partial<ScheduleItemRecord> = {},
): ScheduleItemRecord => ({
  id: 1,
  createdAt: new Date('2026-11-04T00:00:00Z'),
  slackUserId: 'U1',
  title: '업무',
  shortTitle: null,
  shortTitleBasis: null,
  dueDate: null,
  dueTime: null,
  linkUrl: null,
  memo: null,
  status: ScheduleStatus.OPEN,
  completedAt: null,
  isHoliday: false,
  ...overrides,
});
