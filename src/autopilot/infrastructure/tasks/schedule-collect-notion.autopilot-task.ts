import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { plainDateToUtcDate } from '../../../agent/vacation/domain/plain-date';
import { appendIntegrationHint } from '../../../common/domain/integration-failure-hint';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { CloseFinishedNotionTasksUsecase } from '../../../schedule/application/close-finished-notion-tasks.usecase';
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
  ScheduleActor,
  ScheduleEventRecord,
} from '../../../schedule/domain/schedule.repository.type';
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
  NotionReopenInput,
  NotionSourceEditInput,
  ReadListInput,
} from '../../domain/schedule-collect-notion.type';

// 에러리포트 DB 가 수백 건이라 넉넉히 둔다. 넘으면 클라이언트가 잘림 경고를 남긴다.
const NOTION_COLLECT_PER_DB_LIMIT = 1000;

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
    private readonly closeFinished: CloseFinishedNotionTasksUsecase,
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
      droppedValues: this.readList({
        key: 'SCHEDULE_NOTION_DROPPED_VALUES',
        fallback: [],
      }),
      dueProperty: this.configService
        .get<string>('SCHEDULE_NOTION_DUE_PROPERTY')
        ?.trim(),
    };
    try {
      // Slack·GitHub 와 달리 기간으로 자르지 않는다 — 몇 달째 손대지 않은 진행 중 업무도
      // 내 할 일이다. 매 회차 전수 조회하고 담당자·상태는 아래 필터가 거른다.
      const tasks = await this.listActiveTasks.execute({
        skipStaleCutoff: true,
        perDatabaseLimit: NOTION_COLLECT_PER_DB_LIMIT,
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
          await this.reopenIfCollectorClosed({
            found,
            notionTask,
            ownerId,
            now,
          });
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
    try {
      await this.closeFinished.execute({ ownerId, now, config });
    } catch (error) {
      this.logger.warn(
        `Notion 업무 완료 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { skip: true };
  }

  // Notion 에서 완료·아카이브됐다가 다시 진행 중이 된 업무를 되살린다.
  // 이대리가 자동으로 닫은 것만 연다 — 사용자가 직접 끝낸 항목을 다시 열면 매 회차 결정을 뒤집는다.
  private async reopenIfCollectorClosed({
    found,
    notionTask,
    ownerId,
    now,
  }: NotionReopenInput): Promise<void> {
    if (
      found.status !== ScheduleStatus.DONE &&
      found.status !== ScheduleStatus.SKIPPED
    ) {
      return;
    }
    const detail = await this.repository.findDetail({
      id: found.id,
      slackUserId: ownerId,
    });
    // occurredAt 은 회차 시작 시각이라 회차 중 사용자 전환보다 앞설 수 있다 — 기록 순서(id)로 마지막을 고른다.
    const lastChange = detail?.events
      .filter((event) => event.kind === ScheduleEventKind.STATUS_CHANGED)
      .reduce<
        ScheduleEventRecord | undefined
      >((latest, event) => (!latest || event.id > latest.id ? event : latest), undefined);
    if (!isChangedBy(lastChange?.payload, ScheduleActor.COLLECTOR)) {
      return;
    }
    await this.repository.recordEventAndTransition({
      event: {
        scheduleItemId: found.id,
        kind: ScheduleEventKind.NOTE,
        payload: {
          text: 'Notion 업무가 다시 진행 중이 되어 할 일로 되돌렸습니다.',
          sourceUrl: notionTask.url,
        },
        dedupeKey: `notion-reopened:${notionTask.pageId}:${now.toISOString()}`,
        occurredAt: now,
      },
      slackUserId: ownerId,
      transitionFrom: [ScheduleStatus.DONE, ScheduleStatus.SKIPPED],
      transitionTo: ScheduleStatus.OPEN,
      now,
      actor: ScheduleActor.COLLECTOR,
    });
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

const isChangedBy = (payload: unknown, actor: ScheduleActor): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  (payload as Record<string, unknown>).actor === actor;
