import { parsePlainDate } from '../../agent/vacation/domain/plain-date';
import { NotionTask } from '../../notion/domain/notion.type';
import {
  FilteredNotionTask,
  NotionTaskFilterConfig,
} from './notion-task-filter.type';

export type NotionStatus = 'DONE' | 'DROPPED' | 'ACTIVE';

export const readNotionStatus = (
  properties: Record<string, string>,
  config: NotionTaskFilterConfig,
): NotionStatus => {
  if (
    config.statusProperties.some((property) =>
      config.droppedValues.includes(properties[property]),
    )
  ) {
    return 'DROPPED';
  }
  if (
    config.statusProperties.some((property) =>
      config.doneValues.includes(properties[property]),
    )
  ) {
    return 'DONE';
  }
  return 'ACTIVE';
};

export const filterMyNotionTask = (
  task: NotionTask,
  config: NotionTaskFilterConfig,
): FilteredNotionTask | null => {
  const assignees = (task.properties[config.assigneeProperty] ?? '')
    .split(',')
    .map((name) => name.trim());
  // 개인·회사 워크스페이스에서 내 표시 이름이 다를 수 있어 쉼표로 여러 이름을 받는다.
  // 빈 이름은 버린다 — 끝 쉼표 하나로 담당자 없는 업무('')가 전부 내 업무가 된다.
  const myNames = config.assigneeValue
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (!assignees.some((name) => myNames.includes(name))) {
    return null;
  }
  if (readNotionStatus(task.properties, config) !== 'ACTIVE') {
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
