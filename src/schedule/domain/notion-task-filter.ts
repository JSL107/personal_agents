import { parsePlainDate } from '../../agent/vacation/domain/plain-date';
import { NotionTask } from '../../notion/domain/notion.type';
import {
  FilteredNotionTask,
  NotionTaskFilterConfig,
  PickNotionStatusValueInput,
} from './notion-task-filter.type';

export type NotionStatus = 'DONE' | 'DROPPED' | 'ACTIVE';

// 나열 순서상 값이 있는 첫 칸 하나가 판정한다. 작업 현황 DB 는 분류용 `상태` 칸에도 완료·아카이브가 있어,
// 아무 칸이나 종료값이면 닫으면 진행 중 카드가 닫힌다 — 그래서 env 에 `진행단계` 를 `상태` 앞에 둔다.
// 빈 칸은 Notion 응답에서 빠지므로 칸이 없는 DB 는 다음 칸으로 넘어간다.
export const pickNotionStatusValue = ({
  properties,
  config,
}: PickNotionStatusValueInput): string | null =>
  config.statusProperties
    .map((property) => properties[property])
    .find((value) => value !== undefined && value.length > 0) ?? null;

export const readNotionStatus = (
  properties: Record<string, string>,
  config: NotionTaskFilterConfig,
): NotionStatus => {
  const value = pickNotionStatusValue({ properties, config });
  if (value === null) {
    return 'ACTIVE';
  }
  if (config.droppedValues.includes(value)) {
    return 'DROPPED';
  }
  if (config.doneValues.includes(value)) {
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
  const status = pickNotionStatusValue({
    properties: task.properties,
    config,
  });
  return { title, startDate, dueDate, status };
};
