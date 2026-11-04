import { parsePlainDate } from '../../agent/vacation/domain/plain-date';
import { NotionTask } from '../../notion/domain/notion.type';
import {
  FilteredNotionTask,
  NotionTaskFilterConfig,
} from './notion-task-filter.type';

export const filterMyNotionTask = (
  task: NotionTask,
  config: NotionTaskFilterConfig,
): FilteredNotionTask | null => {
  const assignees = (task.properties[config.assigneeProperty] ?? '')
    .split(',')
    .map((name) => name.trim());
  if (!assignees.includes(config.assigneeValue)) {
    return null;
  }
  if (config.doneValues.includes(task.properties[config.statusProperty])) {
    return null;
  }
  const dateText = config.dueProperty
    ? task.properties[config.dueProperty]
    : undefined;
  const dates = dateText?.split('→').map((part) => part.trim().slice(0, 10));
  const first = dates?.[0] ? parsePlainDate(dates[0]) : null;
  const second = dates?.[1] ? parsePlainDate(dates[1]) : null;
  return {
    title: task.title.slice(0, 200),
    startDate: second ? first : null,
    dueDate: second ?? first,
  };
};
