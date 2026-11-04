import { ScheduleSource } from '../schedule.type';

export interface ScheduleCollectionStateRepositoryPort {
  get(source: ScheduleSource): Promise<Date | null>;
  markSucceeded(source: ScheduleSource, at: Date): Promise<void>;
}

export const SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT = Symbol(
  'SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT',
);
