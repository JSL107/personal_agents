import { PlainDate } from './schedule.type';

export interface NotionTaskFilterConfig {
  assigneeProperty: string;
  assigneeValue: string;
  statusProperty: string;
  doneValues: string[];
  dueProperty?: string;
}

export interface FilteredNotionTask {
  title: string;
  dueDate: PlainDate | null;
  startDate: PlainDate | null;
}
