import { ConfigService } from '@nestjs/config';

import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { NotionTask } from '../../../notion/domain/notion.type';
import { CloseFinishedNotionTasksUsecase } from '../../../schedule/application/close-finished-notion-tasks.usecase';
import { ScheduleRepositoryPort } from '../../../schedule/domain/port/schedule.repository.port';
import { ScheduleCollectionStateRepositoryPort } from '../../../schedule/domain/port/schedule-collection-state.repository.port';
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
    addEvent: jest.fn(),
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

  it('명시 하한·100건으로 조회하고 담당 업무를 OPEN으로 수집한다', async () => {
    await task.run();
    expect(listActiveTasks.execute).toHaveBeenCalledWith({
      lastEditedSinceIsoDateTime: '2026-10-31T15:00:00.000Z',
      perDatabaseLimit: 100,
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
});
