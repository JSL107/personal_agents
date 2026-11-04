import { NotionTask } from '../../notion/domain/notion.type';
import { filterMyNotionTask } from './notion-task-filter';
import { NotionTaskFilterConfig } from './notion-task-filter.type';

describe('filterMyNotionTask', () => {
  const config: NotionTaskFilterConfig = {
    assigneeProperty: '담당자',
    assigneeValue: '김준석',
    statusProperty: '상태',
    doneValues: ['완료', 'Done'],
    dueProperty: '마감일',
  };
  const task: NotionTask = {
    databaseId: 'db',
    pageId: 'page',
    url: 'https://notion.so/page',
    title: '업무',
    properties: {
      담당자: '김준석, 이OO',
      상태: '진행중',
      마감일: '2026-11-05 → 2026-11-10',
    },
  };

  it('담당자 토큰이 완전 일치하면 날짜 범위를 시작일·마감일로 분해한다', () => {
    expect(filterMyNotionTask(task, config)).toEqual({
      title: '업무',
      startDate: { year: 2026, month: 11, day: 5 },
      dueDate: { year: 2026, month: 11, day: 10 },
    });
  });

  it('담당자 부분 일치는 제외한다', () => {
    expect(
      filterMyNotionTask(task, { ...config, assigneeValue: '김준' }),
    ).toBeNull();
  });

  it('완료 상태는 제외한다', () => {
    expect(
      filterMyNotionTask(
        { ...task, properties: { ...task.properties, 상태: '완료' } },
        config,
      ),
    ).toBeNull();
  });

  it('단일 날짜의 시간은 버리고 기한만 설정한다', () => {
    expect(
      filterMyNotionTask(
        {
          ...task,
          properties: { ...task.properties, 마감일: '2026-11-05T12:30:00Z' },
        },
        config,
      ),
    ).toEqual({
      title: '업무',
      startDate: null,
      dueDate: { year: 2026, month: 11, day: 5 },
    });
  });
});
