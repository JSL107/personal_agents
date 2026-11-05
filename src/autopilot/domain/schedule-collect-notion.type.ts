import { NotionTask } from '../../notion/domain/notion.type';
import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';

export interface NotionSourceEditInput {
  found: ScheduleItemRecord;
  notionTask: NotionTask;
  title: string;
  dueDate: Date | null;
  now: Date;
}

export interface NotionReopenInput {
  found: ScheduleItemRecord;
  notionTask: NotionTask;
  ownerId: string;
  now: Date;
}

export interface ReadListInput {
  key: string;
  fallback: string[];
}
