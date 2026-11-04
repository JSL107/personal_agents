import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../notion/domain/port/notion-client.port';
import { AUTO_COMPLETE_CHECK_MAX } from '../domain/daily-todo.constant';
import { readNotionStatus } from '../domain/notion-task-filter';
import { NotionTaskFilterConfig } from '../domain/notion-task-filter.type';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { ScheduleActor } from '../domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleItemRecord,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { toSourceCompletedAt } from '../domain/source-completed-at';

interface CloseFinishedNotionTasksInput {
  ownerId: string;
  now: Date;
  config: NotionTaskFilterConfig;
}

@Injectable()
export class CloseFinishedNotionTasksUsecase {
  private readonly logger = new Logger(CloseFinishedNotionTasksUsecase.name);
  private cursorId = 0;

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(NOTION_CLIENT_PORT) private readonly notion: NotionClientPort,
  ) {}

  async execute(input: CloseFinishedNotionTasksInput): Promise<void> {
    const items = await this.repository.findBySource({
      slackUserId: input.ownerId,
      source: ScheduleSource.NOTION_TASK,
    });
    const candidates = items
      .filter(
        (item) =>
          item.status === ScheduleStatus.OPEN ||
          item.status === ScheduleStatus.IN_PROGRESS,
      )
      .sort((left, right) => left.id - right.id);
    const batch = [
      ...candidates.filter((item) => item.id > this.cursorId),
      ...candidates.filter((item) => item.id <= this.cursorId),
    ].slice(0, AUTO_COMPLETE_CHECK_MAX);
    for (const item of batch) {
      this.cursorId = item.id;
      await this.closeIfFinished({ item, ...input });
    }
  }

  private async closeIfFinished({
    item,
    ownerId,
    now,
    config,
  }: CloseFinishedNotionTasksInput & {
    item: ScheduleItemRecord;
  }): Promise<void> {
    if (!item.sourceKey) {
      return;
    }
    try {
      const page = await this.notion.getPageStatus(item.sourceKey);
      const status =
        page.archived || page.inTrash
          ? 'DROPPED'
          : readNotionStatus(page.properties, config);
      if (status === 'ACTIVE') {
        return;
      }
      await this.repository.recordEventAndTransition({
        event: {
          scheduleItemId: item.id,
          kind: ScheduleEventKind.NOTE,
          payload: {
            text:
              status === 'DONE'
                ? 'Notion 업무가 완료됐습니다.'
                : 'Notion 업무가 그만둔 일로 닫혔습니다.',
          },
          dedupeKey: `notion-closed:${item.sourceKey}`,
          occurredAt: now,
        },
        slackUserId: ownerId,
        transitionFrom: [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS],
        transitionTo:
          status === 'DONE' ? ScheduleStatus.DONE : ScheduleStatus.SKIPPED,
        now,
        ...(status === 'DONE'
          ? {
              completedAt: toSourceCompletedAt({
                source: page.lastEditedTime,
                now,
              }),
            }
          : {}),
        actor: ScheduleActor.COLLECTOR,
      });
    } catch (error) {
      this.logger.warn(
        `Notion 업무 상태 확인 실패(${item.sourceKey}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
