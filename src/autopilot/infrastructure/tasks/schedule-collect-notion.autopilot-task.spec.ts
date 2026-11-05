import { ConfigService } from '@nestjs/config';

import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { NotionWorkspace } from '../../../notion/domain/notion.type';
import { NotionTask } from '../../../notion/domain/notion.type';
import { CloseFinishedNotionTasksUsecase } from '../../../schedule/application/close-finished-notion-tasks.usecase';
import { ScheduleRepositoryPort } from '../../../schedule/domain/port/schedule.repository.port';
import { ScheduleCollectionStateRepositoryPort } from '../../../schedule/domain/port/schedule-collection-state.repository.port';
import { ScheduleActor } from '../../../schedule/domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import { ScheduleCollectNotionAutopilotTask } from './schedule-collect-notion.autopilot-task';

describe('ScheduleCollectNotionAutopilotTask', () => {
  const repository = {
    findBySourceKey: jest.fn(),
    createCollected: jest.fn(),
    updateSourceWorkspace: jest.fn(),
    addEvent: jest.fn(),
    findDetail: jest.fn(),
    recordEventAndTransition: jest.fn(),
  };
  const stateRepository = { get: jest.fn(), markSucceeded: jest.fn() };
  const listActiveTasks = { execute: jest.fn() };
  const configService = { get: jest.fn() };
  const closeFinished = { execute: jest.fn() };
  const task = new ScheduleCollectNotionAutopilotTask(
    repository as unknown as ScheduleRepositoryPort,
    stateRepository as unknown as ScheduleCollectionStateRepositoryPort,
    listActiveTasks as unknown as ListActiveTasksUsecase,
    configService as unknown as ConfigService,
    closeFinished as unknown as CloseFinishedNotionTasksUsecase,
  );
  const notionTask: NotionTask = {
    databaseId: 'db',
    workspace: NotionWorkspace.PERSONAL,
    pageId: 'page',
    url: 'https://notion.so/page',
    title: '결제 업무',
    properties: {
      담당자: '김준석',
      상태: '진행중',
      마감일: '2026-11-05 → 2026-11-10',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T02:00:00Z'));
    configService.get.mockImplementation(
      (key: string) =>
        ({
          CONSOLE_OWNER_SLACK_USER_ID: 'UOWNER',
          SCHEDULE_NOTION_ASSIGNEE_PROPERTY: '담당자',
          SCHEDULE_NOTION_ASSIGNEE_VALUE: '김준석',
          SCHEDULE_NOTION_DUE_PROPERTY: '마감일',
          SCHEDULE_NOTION_DONE_VALUES: '완료,Done',
          SCHEDULE_NOTION_DROPPED_VALUES: '중단, 중복',
        })[key],
    );
    stateRepository.get.mockResolvedValue(null);
    repository.findBySourceKey.mockResolvedValue(null);
    repository.createCollected.mockResolvedValue('DUPLICATE');
    repository.addEvent.mockResolvedValue('DUPLICATE');
    listActiveTasks.execute.mockResolvedValue([notionTask]);
  });
  afterEach(() => jest.useRealTimers());

  it('수집이 끝나면 중단 값과 함께 완료 확인을 호출하고 실패를 격리한다', async () => {
    closeFinished.execute.mockRejectedValueOnce(new Error('failed'));
    await expect(task.run()).resolves.toEqual({ skip: true });
    expect(closeFinished.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'UOWNER',
        config: expect.objectContaining({ droppedValues: ['중단', '중복'] }),
      }),
    );
    expect(stateRepository.markSucceeded).toHaveBeenCalled();
  });

  it('담당자 설정이 비면 Notion을 호출하지 않는다', async () => {
    configService.get.mockReturnValue(undefined);
    expect(await task.run()).toEqual({ skip: true });
    expect(listActiveTasks.execute).not.toHaveBeenCalled();
  });

  it('기간 하한 없이 전수 조회하고 담당 업무를 OPEN으로 수집한다', async () => {
    // 직전 성공 시각이 있어도 하한으로 쓰지 않는다 — 오래된 진행 중 업무가 영영 빠졌다.
    stateRepository.get.mockResolvedValue(new Date('2026-11-04T01:00:00Z'));
    await task.run();
    expect(listActiveTasks.execute).toHaveBeenCalledWith({
      skipStaleCutoff: true,
      perDatabaseLimit: 5000,
      requireAllDatabases: true,
    });
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'UOWNER',
        source: ScheduleSource.NOTION_TASK,
        sourceKey: 'page',
        status: ScheduleStatus.OPEN,
        startDate: new Date('2026-11-05T00:00:00Z'),
        dueDate: new Date('2026-11-10T00:00:00Z'),
      }),
    );
    expect(stateRepository.markSucceeded).toHaveBeenCalledWith(
      ScheduleSource.NOTION_TASK,
      new Date('2026-11-04T02:00:00Z'),
    );
  });

  it('기존 업무의 원천 제목·마감일 변경은 NOTE 한 건으로 남긴다', async () => {
    repository.findBySourceKey.mockResolvedValue({
      id: 17,
      title: '옛 제목',
      dueDate: null,
    });
    await task.run();
    expect(repository.createCollected).not.toHaveBeenCalled();
    expect(repository.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleItemId: 17,
        kind: ScheduleEventKind.NOTE,
        dedupeKey: expect.stringMatching(/^notion-edit:/),
      }),
    );
  });

  it('워크스페이스가 비어 있는 기존 업무는 수집한 워크스페이스로 채우고, 같으면 건드리지 않는다', async () => {
    repository.findBySourceKey.mockResolvedValue({
      id: 17,
      title: '결제 업무',
      dueDate: new Date('2026-11-10T00:00:00Z'),
      sourceWorkspace: null,
    });
    await task.run();
    expect(repository.updateSourceWorkspace).toHaveBeenCalledWith({
      id: 17,
      sourceWorkspace: NotionWorkspace.PERSONAL,
    });

    repository.updateSourceWorkspace.mockClear();
    repository.findBySourceKey.mockResolvedValue({
      id: 17,
      title: '결제 업무',
      dueDate: new Date('2026-11-10T00:00:00Z'),
      sourceWorkspace: NotionWorkspace.PERSONAL,
    });
    await task.run();
    expect(repository.updateSourceWorkspace).not.toHaveBeenCalled();
  });

  it('새 업무는 워크스페이스와 함께 만든다', async () => {
    await task.run();
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({ sourceWorkspace: NotionWorkspace.PERSONAL }),
    );
  });

  it('Notion 조회 실패 시 성공 커서를 갱신하지 않는다', async () => {
    listActiveTasks.execute.mockRejectedValue(new Error('notion unavailable'));
    expect(await task.run()).toEqual({ skip: true });
    expect(stateRepository.markSucceeded).not.toHaveBeenCalled();
  });

  it('기존 업무 변경 NOTE 기록이 실패하면 성공 커서를 갱신하지 않는다', async () => {
    repository.findBySourceKey.mockResolvedValue({
      id: 17,
      title: '옛 제목',
      dueDate: null,
    });
    repository.addEvent.mockRejectedValue(new Error('write failed'));
    expect(await task.run()).toEqual({ skip: true });
    expect(stateRepository.markSucceeded).not.toHaveBeenCalled();
  });

  it('기존 업무와 원천 제목·마감일이 같으면 NOTE를 만들지 않는다', async () => {
    repository.findBySourceKey.mockResolvedValue({
      id: 17,
      title: '결제 업무',
      dueDate: new Date('2026-11-10T00:00:00Z'),
    });
    await task.run();
    expect(repository.addEvent).not.toHaveBeenCalled();
  });

  const closedItem = {
    id: 17,
    title: '결제 업무',
    dueDate: new Date('2026-11-10T00:00:00Z'),
    status: ScheduleStatus.DONE,
  };
  const statusChangedBy = (actor: ScheduleActor) => ({
    events: [
      { id: 3, kind: ScheduleEventKind.NOTE, payload: { text: '메모' } },
      {
        id: 2,
        kind: ScheduleEventKind.STATUS_CHANGED,
        payload: { from: 'OPEN', to: 'DONE', actor },
      },
    ],
  });

  it('이대리가 닫은 업무가 Notion 에서 다시 진행 중이면 OPEN 으로 되살린다', async () => {
    repository.findBySourceKey.mockResolvedValue(closedItem);
    repository.findDetail.mockResolvedValue(
      statusChangedBy(ScheduleActor.COLLECTOR),
    );
    await task.run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          scheduleItemId: 17,
          kind: ScheduleEventKind.NOTE,
          dedupeKey: 'notion-reopened:page:2026-11-04T02:00:00.000Z',
        }),
        slackUserId: 'UOWNER',
        transitionFrom: [ScheduleStatus.DONE, ScheduleStatus.SKIPPED],
        transitionTo: ScheduleStatus.OPEN,
        actor: ScheduleActor.COLLECTOR,
      }),
    );
    expect(repository.createCollected).not.toHaveBeenCalled();
  });

  it('사용자가 직접 끝낸 업무는 Notion 이 진행 중이어도 되살리지 않는다', async () => {
    repository.findBySourceKey.mockResolvedValue(closedItem);
    repository.findDetail.mockResolvedValue(
      statusChangedBy(ScheduleActor.USER),
    );
    await task.run();
    expect(repository.recordEventAndTransition).not.toHaveBeenCalled();
  });

  it('열려 있는 업무는 상태 이력을 조회하지 않는다', async () => {
    repository.findBySourceKey.mockResolvedValue({
      ...closedItem,
      status: ScheduleStatus.OPEN,
    });
    await task.run();
    expect(repository.findDetail).not.toHaveBeenCalled();
    expect(repository.recordEventAndTransition).not.toHaveBeenCalled();
  });

  it('SKIPPED 로 닫힌 업무도 이대리가 닫았으면 되살린다', async () => {
    repository.findBySourceKey.mockResolvedValue({
      ...closedItem,
      status: ScheduleStatus.SKIPPED,
    });
    repository.findDetail.mockResolvedValue(
      statusChangedBy(ScheduleActor.COLLECTOR),
    );
    await task.run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledTimes(1);
  });

  it('마지막 상태 변경은 occurredAt 이 아니라 기록 순서로 고른다', async () => {
    // 회차 시작 시각으로 찍힌 이대리의 닫힘(id 9)이 회차 중 사용자의 열기(id 8)보다 뒤에 기록된 경우.
    repository.findBySourceKey.mockResolvedValue(closedItem);
    repository.findDetail.mockResolvedValue({
      events: [
        {
          id: 8,
          kind: ScheduleEventKind.STATUS_CHANGED,
          occurredAt: new Date('2026-11-04T02:00:05Z'),
          payload: { from: 'DONE', to: 'OPEN', actor: ScheduleActor.USER },
        },
        {
          id: 9,
          kind: ScheduleEventKind.STATUS_CHANGED,
          occurredAt: new Date('2026-11-04T02:00:00Z'),
          payload: { from: 'OPEN', to: 'DONE', actor: ScheduleActor.COLLECTOR },
        },
      ],
    });
    await task.run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledTimes(1);
  });

  it('사용자가 나중에 직접 닫았으면 앞선 이대리 닫힘이 있어도 되살리지 않는다', async () => {
    repository.findBySourceKey.mockResolvedValue(closedItem);
    repository.findDetail.mockResolvedValue({
      events: [
        {
          id: 12,
          kind: ScheduleEventKind.STATUS_CHANGED,
          payload: { from: 'OPEN', to: 'DONE', actor: ScheduleActor.USER },
        },
        {
          id: 11,
          kind: ScheduleEventKind.STATUS_CHANGED,
          payload: { from: 'DONE', to: 'OPEN', actor: ScheduleActor.USER },
        },
        {
          id: 10,
          kind: ScheduleEventKind.STATUS_CHANGED,
          payload: { from: 'OPEN', to: 'DONE', actor: ScheduleActor.COLLECTOR },
        },
      ],
    });
    await task.run();
    expect(repository.recordEventAndTransition).not.toHaveBeenCalled();
  });
});
