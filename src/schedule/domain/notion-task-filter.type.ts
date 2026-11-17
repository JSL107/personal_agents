import { PlainDate } from './schedule.type';

export interface NotionTaskFilterConfig {
  assigneeProperty: string;
  assigneeValue: string;
  statusProperties: string[];
  doneValues: string[];
  droppedValues: string[];
  dueProperty?: string;
}

export interface PickNotionStatusValueInput {
  properties: Record<string, string>;
  config: NotionTaskFilterConfig;
}

export interface FilteredNotionTask {
  title: string;
  dueDate: PlainDate | null;
  startDate: PlainDate | null;
  status: string | null;
}
