import { NotionWorkspace } from '../../notion/domain/notion.type';
import { NotionTask } from '../../notion/domain/notion.type';
import { filterMyNotionTask, readNotionStatus } from './notion-task-filter';
import { NotionTaskFilterConfig } from './notion-task-filter.type';

describe('filterMyNotionTask', () => {
  const config: NotionTaskFilterConfig = {
    assigneeProperty: '담당자',
    assigneeValue: '김준석',
    statusProperties: ['상태'],
    doneValues: ['완료', 'Done'],
    droppedValues: [],
    dueProperty: '마감일',
  };
  const task: NotionTask = {
    databaseId: 'db',
    workspace: NotionWorkspace.PERSONAL,
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
      status: '진행중',
    });
  });

  // 개인·회사 워크스페이스에서 내 표시 이름이 다르다 — 나열한 이름 중 하나만 맞으면 내 업무다.
  it('담당자 값을 쉼표로 여러 개 주면 그중 하나만 일치해도 가져온다', () => {
    const work: NotionTask = {
      ...task,
      properties: { ...task.properties, 담당자: '이준석' },
    };
    expect(
      filterMyNotionTask(work, { ...config, assigneeValue: '김준석, 이준석' }),
    ).not.toBeNull();
    expect(filterMyNotionTask(work, config)).toBeNull();
  });

  it('담당자 값 끝 쉼표가 담당자 없는 업무를 통과시키지 않는다', () => {
    const unassigned: NotionTask = {
      ...task,
      properties: { ...task.properties, 담당자: '' },
    };
    expect(
      filterMyNotionTask(unassigned, { ...config, assigneeValue: '김준석,' }),
    ).toBeNull();
  });

  it('담당자 부분 일치는 제외한다', () => {
    expect(
      filterMyNotionTask(task, { ...config, assigneeValue: '김준' }),
    ).toBeNull();
  });

  // DB 마다 완료 칸 이름이 다르다 — 작업 현황 DB 는 `상태` 가 분류용 select 이고 완료는 `진행단계` 에 있다.
  // 분류용 `상태` 에도 완료·아카이브가 있어, 아무 칸이나 종료값이면 닫으면 진행 중 카드가 닫힌다.
  it('나열 순서상 값이 있는 첫 칸 하나가 판정한다', () => {
    const integration: NotionTask = {
      ...task,
      properties: { 담당자: '김준석', 상태: '개발', 진행단계: '완료' },
    };
    const ordered = { ...config, statusProperties: ['진행단계', '상태'] };
    expect(filterMyNotionTask(integration, ordered)).toBeNull();
    expect(
      filterMyNotionTask(
        {
          ...integration,
          properties: { 담당자: '김준석', 상태: '완료', 진행단계: '진행중' },
        },
        ordered,
      ),
    ).toMatchObject({ status: '진행중' });
  });

  it('앞 칸이 비면 다음 칸이 판정한다 — 그 칸이 없는 DB 도 같은 목록으로 거른다', () => {
    const ordered = {
      ...config,
      statusProperties: ['실제 완료 여부', '진행단계', '상태'],
    };
    expect(readNotionStatus({ 상태: '완료' }, ordered)).toBe('DONE');
    expect(readNotionStatus({ '실제 완료 여부': '중지' }, ordered)).toBe(
      'ACTIVE',
    );
    expect(
      readNotionStatus(
        { '실제 완료 여부': '중지' },
        { ...ordered, droppedValues: ['중지'] },
      ),
    ).toBe('DROPPED');
    expect(readNotionStatus({}, ordered)).toBe('ACTIVE');
  });

  it('완료 상태는 제외한다', () => {
    expect(
      filterMyNotionTask(
        { ...task, properties: { ...task.properties, 상태: '완료' } },
        config,
      ),
    ).toBeNull();
  });

  it('두 목록에 다 있는 값은 DROPPED 가 먼저다', () => {
    const both = {
      ...config,
      doneValues: ['완료', '아카이브'],
      droppedValues: ['아카이브'],
    };
    expect(readNotionStatus({ 상태: '아카이브' }, both)).toBe('DROPPED');
  });

  it('수집은 DONE·DROPPED 를 모두 거른다', () => {
    const both = { ...config, droppedValues: ['중복'] };
    expect(
      filterMyNotionTask(
        { ...task, properties: { ...task.properties, 상태: '중복' } },
        both,
      ),
    ).toBeNull();
    expect(
      filterMyNotionTask(
        { ...task, properties: { ...task.properties, 상태: '완료' } },
        both,
      ),
    ).toBeNull();
  });

  it('DROPPED_VALUES 가 비어 있으면 지금과 같다', () => {
    expect(readNotionStatus(task.properties, config)).toBe('ACTIVE');
    expect(readNotionStatus({ ...task.properties, 상태: '완료' }, config)).toBe(
      'DONE',
    );
    expect(filterMyNotionTask(task, config)).not.toBeNull();
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
      status: '진행중',
    });
  });
});
