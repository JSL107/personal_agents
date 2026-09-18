import { ScheduleItemRecord, ScheduleStatus } from '../schedule.type';

export interface SaveScheduleInput {
  slackUserId: string;
  title: string;
  dueDate: Date;
  dueTime?: string;
  memo?: string;
}

export interface FindByDateRangeInput {
  slackUserId: string;
  from: Date;
  to: Date;
}

export interface UpdateStatusInput {
  id: number;
  status: ScheduleStatus;
  completedAt: Date | null;
}

export interface ScheduleRepositoryPort {
  save(input: SaveScheduleInput): Promise<ScheduleItemRecord>;
  findByDateRange(input: FindByDateRangeInput): Promise<ScheduleItemRecord[]>;
  findById(id: number): Promise<ScheduleItemRecord | null>;
  updateStatus(input: UpdateStatusInput): Promise<ScheduleItemRecord>;
  deleteById(id: number): Promise<void>;
}

export const SCHEDULE_REPOSITORY_PORT = Symbol('SCHEDULE_REPOSITORY_PORT');
