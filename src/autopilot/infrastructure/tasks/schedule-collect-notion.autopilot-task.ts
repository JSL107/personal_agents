import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { plainDateToUtcDate } from '../../../agent/vacation/domain/plain-date';
import { appendIntegrationHint } from '../../../common/domain/integration-failure-hint';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { resolveCollectionLowerBound } from '../../../schedule/application/collection-window';
import { filterMyNotionTask } from '../../../schedule/domain/notion-task-filter';
import { NotionTaskFilterConfig } from '../../../schedule/domain/notion-task-filter.type';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../../../schedule/domain/port/schedule.repository.port';
import {
  SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT,
  ScheduleCollectionStateRepositoryPort,
} from '../../../schedule/domain/port/schedule-collection-state.repository.port';
import {
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  NotionSourceEditInput,
  ReadListInput,
} from '../../domain/schedule-collect-notion.type';

@Injectable()
export class ScheduleCollectNotionAutopilotTask implements AutopilotTask {
  readonly id = 'schedule-collect-notion';
  private readonly logger = new Logger(ScheduleCollectNotionAutopilotTask.name);

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT)
    private readonly stateRepository: ScheduleCollectionStateRepositoryPort,
    private readonly listActiveTasks: ListActiveTasksUsecase,
    private readonly configService: ConfigService,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    const ownerId = this.configService.get<string>(
      'CONSOLE_OWNER_SLACK_USER_ID',
    );
    const assigneeProperty = this.configService
      .get<string>('SCHEDULE_NOTION_ASSIGNEE_PROPERTY')
      ?.trim();
    const assigneeValue = this.configService
      .get<string>('SCHEDULE_NOTION_ASSIGNEE_VALUE')
      ?.trim();
    if (!ownerId || !assigneeProperty || !assigneeValue) {
      this.logger.warn(
        'Notion 업무 수집 설정 미완료: 소유자 또는 담당자 설정 누락',
      );
      return { skip: true };
    }
    const now = new Date();
    const config: NotionTaskFilterConfig = {
      assigneeProperty,
      assigneeValue,
      statusProperties: this.readList({
        key: 'SCHEDULE_NOTION_STATUS_PROPERTY',
        fallback: ['상태'],
      }),
      doneValues: this.readList({
        key: 'SCHEDULE_NOTION_DONE_VALUES',
        fallback: [],
      }),
      dueProperty: this.configService
        .get<string>('SCHEDULE_NOTION_DUE_PROPERTY')
        ?.trim(),
    };
    try {
      const lowerBound = resolveCollectionLowerBound({
        lastSucceededAt: await this.stateRepository.get(
          ScheduleSource.NOTION_TASK,
        ),
        now,
      });
      const tasks = await this.listActiveTasks.execute({
        lastEditedSinceIsoDateTime: lowerBound.toISOString(),
        perDatabaseLimit: 100,
        requireAllDatabases: true,
      });
      for (const notionTask of tasks) {
        const filtered = filterMyNotionTask(notionTask, config);
        if (!filtered) {
          continue;
        }
        const dueDate = filtered.dueDate
          ? plainDateToUtcDate(filtered.dueDate)
          : null;
        const startDate = filtered.startDate
          ? plainDateToUtcDate(filtered.startDate)
          : null;
        const found = await this.repository.findBySourceKey({
          slackUserId: ownerId,
          source: ScheduleSource.NOTION_TASK,
          sourceKey: notionTask.pageId,
        });
        if (found) {
          await this.noteSourceEdit({
            found,
            notionTask,
            title: filtered.title,
            dueDate,
            now,
          });
          continue;
        }
        await this.repository.createCollected({
          slackUserId: ownerId,
          title: filtered.title,
          dueDate,
          startDate,
          source: ScheduleSource.NOTION_TASK,
          sourceKey: notionTask.pageId,
          sourceUrl: notionTask.url,
          status: ScheduleStatus.OPEN,
        });
      }
      await this.stateRepository.markSucceeded(ScheduleSource.NOTION_TASK, now);
    } catch (error) {
      this.logger.warn(
        appendIntegrationHint(
          `Notion 업무 수집 실패: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
    }
    return { skip: true };
  }

  private async noteSourceEdit({
    found,
    notionTask,
    title,
    dueDate,
    now,
  }: NotionSourceEditInput): Promise<void> {
    const oldDate = found.dueDate?.toISOString().slice(0, 10) ?? null;
    const newDate = dueDate?.toISOString().slice(0, 10) ?? null;
    if (found.title === title && oldDate === newDate) {
      return;
    }
    const change = JSON.stringify({ title, dueDate: newDate });
    const hash = createHash('sha256').update(change).digest('hex');
    await this.repository.addEvent({
      scheduleItemId: found.id,
      kind: ScheduleEventKind.NOTE,
      payload: {
        text: `원본 Notion 업무가 수정되었습니다: ${title} (마감 ${newDate ?? '없음'})`.slice(
          0,
          500,
        ),
        sourceUrl: notionTask.url,
      },
      dedupeKey: `notion-edit:${hash}`,
      occurredAt: now,
    });
  }

  // 쉼표로 여러 값을 받는 env. 비었거나 공백뿐이면 fallback.
  private readList({ key, fallback }: ReadListInput): string[] {
    const values = (this.configService.get<string>(key) ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
}
