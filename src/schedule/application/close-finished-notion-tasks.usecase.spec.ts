import { NotionWorkspace } from '../../notion/domain/notion.type';
import {
  NotionClientPort,
  NotionPageStatus,
} from '../../notion/domain/port/notion-client.port';
import { NotionTaskFilterConfig } from '../domain/notion-task-filter.type';
import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleActor } from '../domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { buildScheduleItemRecord } from '../domain/schedule-item.fixture';
import { CloseFinishedNotionTasksUsecase } from './close-finished-notion-tasks.usecase';

const now = new Date('2026-11-04T10:00:00Z');
const config: NotionTaskFilterConfig = {
  assigneeProperty: '담당자',
  assigneeValue: '나',
  statusProperties: ['상태'],
  doneValues: ['완료'],
  droppedValues: ['중단'],
};
const item = buildScheduleItemRecord({
  id: 1,
  source: ScheduleSource.NOTION_TASK,
  sourceKey: 'page',
  status: ScheduleStatus.OPEN,
});
const createUsecase = () => {
  const repository = {
    findBySource: jest.fn().mockResolvedValue([item]),
    recordEventAndTransition: jest.fn().mockResolvedValue('DUPLICATE'),
  } as unknown as jest.Mocked<ScheduleRepositoryPort>;
  const notion = {
    getPageStatus: jest.fn().mockResolvedValue({
      properties: { 상태: '완료' },
      archived: false,
      inTrash: false,
      lastEditedTime: '2026-11-03T09:00:00Z',
    }),
  } as unknown as jest.Mocked<NotionClientPort>;
  return {
    repository,
    notion,
    usecase: new CloseFinishedNotionTasksUsecase(repository, notion),
  };
};

describe('CloseFinishedNotionTasksUsecase', () => {
  it('완료 값이면 원천 수정 시각으로 DONE 전이를 기록한다', async () => {
    const { usecase, repository } = createUsecase();
    await usecase.execute({ ownerId: 'U1', now, config });
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith({
      event: {
        scheduleItemId: 1,
        kind: ScheduleEventKind.NOTE,
        payload: expect.any(Object),
        dedupeKey: 'notion-closed:page:2026-11-03T09:00:00Z',
        occurredAt: now,
      },
      slackUserId: 'U1',
      transitionFrom: [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS],
      transitionTo: ScheduleStatus.DONE,
      completedAt: new Date('2026-11-03T09:00:00Z'),
      now,
      actor: ScheduleActor.COLLECTOR,
    });
  });
  it('되살린 뒤 다시 닫히면 편집 시각이 달라 첫 닫힘과 다른 dedupeKey 를 쓴다', async () => {
    const { usecase, repository, notion } = createUsecase();
    await usecase.execute({ ownerId: 'U1', now, config });
    notion.getPageStatus.mockResolvedValueOnce({
      properties: { 상태: '완료' },
      archived: false,
      inTrash: false,
      lastEditedTime: '2026-11-04T09:00:00Z',
    });
    await usecase.execute({ ownerId: 'U1', now, config });
    const keys = repository.recordEventAndTransition.mock.calls.map(
      ([input]) => input.event.dedupeKey,
    );
    expect(keys).toEqual([
      'notion-closed:page:2026-11-03T09:00:00Z',
      'notion-closed:page:2026-11-04T09:00:00Z',
    ]);
  });
  it.each<Omit<NotionPageStatus, 'lastEditedTime'>>([
    { properties: { 상태: '중단' }, archived: false, inTrash: false },
    { properties: {}, archived: true, inTrash: false },
    { properties: {}, archived: false, inTrash: true },
  ])('중단 상태나 보관·휴지통이면 SKIPPED 된다: %o', async (page) => {
    const { usecase, repository, notion } = createUsecase();
    notion.getPageStatus.mockResolvedValue({
      ...page,
      lastEditedTime: now.toISOString(),
    });
    await usecase.execute({ ownerId: 'U1', now, config });
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({ transitionTo: ScheduleStatus.SKIPPED }),
    );
  });
  it('20건을 넘으면 다음 회차에서 이어서 조회한다', async () => {
    const { usecase, repository, notion } = createUsecase();
    repository.findBySource.mockResolvedValue(
      Array.from({ length: 22 }, (_, index) =>
        buildScheduleItemRecord({
          id: 22 - index,
          source: ScheduleSource.NOTION_TASK,
          sourceKey: `page-${22 - index}`,
          status: ScheduleStatus.OPEN,
        }),
      ),
    );
    await usecase.execute({ ownerId: 'U1', now, config });
    expect(notion.getPageStatus).toHaveBeenCalledTimes(20);
    expect(notion.getPageStatus).toHaveBeenNthCalledWith(1, {
      pageId: 'page-1',
      workspace: undefined,
    });
    await usecase.execute({ ownerId: 'U1', now, config });
    expect(notion.getPageStatus).toHaveBeenNthCalledWith(21, {
      pageId: 'page-21',
      workspace: undefined,
    });
  });

  it('수집 때 기록한 워크스페이스로 상태를 묻는다', async () => {
    const { usecase, repository, notion } = createUsecase();
    repository.findBySource.mockResolvedValue([
      { ...item, sourceWorkspace: NotionWorkspace.WORK },
    ]);
    await usecase.execute({ ownerId: 'U1', now, config });
    expect(notion.getPageStatus).toHaveBeenCalledWith({
      pageId: 'page',
      workspace: NotionWorkspace.WORK,
    });
  });

  it('접근 실패와 진행 중 상태는 변경하지 않는다', async () => {
    const { usecase, repository, notion } = createUsecase();
    notion.getPageStatus
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({
        properties: { 상태: '진행중' },
        archived: false,
        inTrash: false,
        lastEditedTime: now.toISOString(),
      });
    await usecase.execute({ ownerId: 'U1', now, config });
    await usecase.execute({ ownerId: 'U1', now, config });
    expect(repository.recordEventAndTransition).not.toHaveBeenCalled();
  });
});
