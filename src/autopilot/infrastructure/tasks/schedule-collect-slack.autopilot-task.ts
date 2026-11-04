import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { plainDateToUtcDate } from '../../../agent/vacation/domain/plain-date';
import { appendIntegrationHint } from '../../../common/domain/integration-failure-hint';
import { HolidayCalendarPort } from '../../../holiday/domain/port/holiday-calendar.port';
import { HOLIDAY_CALENDAR_PORT } from '../../../holiday/domain/port/holiday-calendar.port';
import { resolveCollectionLowerBound } from '../../../schedule/application/collection-window';
import { JudgeMentionRequestUsecase } from '../../../schedule/application/judge-mention-request.usecase';
import { computeCandidateExpiresAt } from '../../../schedule/domain/business-day-add';
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
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import {
  SLACK_COLLECTOR_PORT,
  SlackCollectorPort,
} from '../../../slack-collector/domain/port/slack-collector.port';
import { SlackMention } from '../../../slack-collector/domain/slack-collector.type';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import { SlackSourceEditInput } from '../../domain/schedule-collect-slack.type';

@Injectable()
export class ScheduleCollectSlackAutopilotTask implements AutopilotTask {
  readonly id = 'schedule-collect-slack';
  private readonly logger = new Logger(ScheduleCollectSlackAutopilotTask.name);

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT)
    private readonly stateRepository: ScheduleCollectionStateRepositoryPort,
    private readonly mentionsUsecase: ListMyMentionsUsecase,
    @Inject(SLACK_COLLECTOR_PORT)
    private readonly collector: SlackCollectorPort,
    private readonly judge: JudgeMentionRequestUsecase,
    @Inject(HOLIDAY_CALENDAR_PORT)
    private readonly holidayCalendar: HolidayCalendarPort,
    private readonly configService: ConfigService,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    const ownerId = this.configService.get<string>(
      'CONSOLE_OWNER_SLACK_USER_ID',
    );
    if (!ownerId) {
      this.logger.warn(
        'CONSOLE_OWNER_SLACK_USER_ID 미설정: Slack 업무 수집 건너뜀',
      );
      return { skip: true };
    }
    const now = new Date();
    try {
      const lowerBound = resolveCollectionLowerBound({
        lastSucceededAt: await this.stateRepository.get(
          ScheduleSource.SLACK_MENTION,
        ),
        now,
      });
      const sinceHours = Math.max(
        1,
        Math.ceil((now.getTime() - lowerBound.getTime()) / 3_600_000),
      );
      const mentions = await this.mentionsUsecase.execute({
        slackUserId: ownerId,
        sinceHours,
        failOnChannelError: true,
      });
      const eligible = mentions
        .filter(
          (mention) =>
            !mention.fromBot &&
            mention.authorUserId !== ownerId &&
            mention.text.includes(`<@${ownerId}>`) &&
            Number(mention.ts) * 1000 >= lowerBound.getTime(),
        )
        .sort((left, right) => Number(right.ts) - Number(left.ts));
      const holidayCalendar = await this.holidayCalendar.load();
      let judgedCount = 0;
      let pending = false;
      for (const mention of eligible) {
        const sourceKey = `${mention.channelId}:${mention.ts}`;
        const found = await this.repository.findBySourceKey({
          slackUserId: ownerId,
          source: ScheduleSource.SLACK_MENTION,
          sourceKey,
        });
        if (found) {
          await this.noteSourceEdit({ found, mention, now });
          continue;
        }
        if (judgedCount >= 10) {
          pending = true;
          continue;
        }
        judgedCount += 1;
        const judgment = await this.judge.execute(mention);
        if (!judgment) {
          pending = true;
          continue;
        }
        const isRequest = judgment.isRequest;
        const sourceUrl = isRequest
          ? await this.safePermalink(mention)
          : undefined;
        await this.repository.createCollected({
          slackUserId: ownerId,
          title: isRequest
            ? judgment.title.slice(0, 200)
            : mention.text.slice(0, 60),
          dueDate:
            isRequest && judgment.dueDate
              ? plainDateToUtcDate(judgment.dueDate)
              : null,
          memo: isRequest ? mention.text.slice(0, 500) : null,
          source: ScheduleSource.SLACK_MENTION,
          sourceKey,
          sourceUrl: sourceUrl ?? null,
          status: isRequest ? ScheduleStatus.CANDIDATE : ScheduleStatus.SKIPPED,
          candidateExpiresAt: isRequest
            ? computeCandidateExpiresAt(now, (date) =>
                holidayCalendar.holidayDates.has(
                  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
                ),
              )
            : null,
        });
      }
      if (!pending) {
        await this.stateRepository.markSucceeded(
          ScheduleSource.SLACK_MENTION,
          now,
        );
      }
    } catch (error) {
      this.logger.warn(
        appendIntegrationHint(
          `Slack 업무 수집 실패: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
    }
    return { skip: true };
  }

  private async safePermalink(
    mention: SlackMention,
  ): Promise<string | undefined> {
    try {
      return await this.collector.getPermalink(mention.channelId, mention.ts);
    } catch (error) {
      this.logger.warn(
        appendIntegrationHint(
          `Slack permalink 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
      return undefined;
    }
  }

  private async noteSourceEdit({
    found,
    mention,
    now,
  }: SlackSourceEditInput): Promise<void> {
    const currentText = mention.text.slice(0, found.memo === null ? 60 : 500);
    const previousText = found.memo ?? found.title;
    if (previousText === currentText) {
      return;
    }
    const hash = createHash('sha256').update(currentText).digest('hex');
    await this.repository.addEvent({
      scheduleItemId: found.id,
      kind: ScheduleEventKind.NOTE,
      payload: {
        text: `원본 Slack 메시지가 수정되었습니다: ${currentText}`.slice(
          0,
          500,
        ),
      },
      dedupeKey: `slack-edit:${hash}`,
      occurredAt: now,
    });
  }
}
