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
  const isDone = config.statusProperties.some((property) =>
    config.doneValues.includes(task.properties[property]),
  );
  if (isDone) {
    return null;
  }
  const dateText = config.dueProperty
    ? task.properties[config.dueProperty]
    : undefined;
  const dates = dateText?.split('→').map((part) => part.trim().slice(0, 10));
  const first = dates?.[0] ? parsePlainDate(dates[0]) : null;
  const second = dates?.[1] ? parsePlainDate(dates[1]) : null;
  const isRange = second !== null;
  const startDate = isRange ? first : null;
  const dueDate = isRange ? second : first;
  const title = task.title.slice(0, 200);
  return { title, startDate, dueDate };
};
