import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { DraftFollowUpMessageUsecase } from '../../../schedule/application/draft-follow-up-message.usecase';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../../../schedule/domain/port/schedule.repository.port';
import {
  FollowUpTrigger,
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import { toKoreanDate } from '../../../slack/format/schedule.formatter';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  ClaimedFollowUp,
  FollowUpItemPair,
  FollowUpMessageInput,
} from '../../domain/schedule-reminder.type';

@Injectable()
export class ScheduleReminderAutopilotTask implements AutopilotTask {
  readonly id = 'schedule-reminder';
  private readonly logger = new Logger(ScheduleReminderAutopilotTask.name);

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    private readonly draftUsecase: DraftFollowUpMessageUsecase,
    private readonly configService: ConfigService,
  ) {
    const scheduleOwner = this.configService.get<string>(
      'CONSOLE_OWNER_SLACK_USER_ID',
    );
    const dmOwner = this.configService.get<string>(
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );
    if (scheduleOwner && dmOwner && scheduleOwner !== dmOwner) {
      this.logger.warn(
        'CONSOLE_OWNER_SLACK_USER_ID와 AUTOPILOT_OWNER_SLACK_USER_ID가 달라 일정 알림의 수신자를 확인해야 합니다.',
      );
    }
  }

  async run(): Promise<AutopilotTaskResult> {
    const ownerId = this.configService.get<string>(
      'CONSOLE_OWNER_SLACK_USER_ID',
    );
    if (!ownerId) {
      return { skip: true };
    }
    const now = new Date();
    const reminders = await this.repository.claimDueReminders({ now, ownerId });
    await this.repository.expireCandidates(now);
    const claimed = await this.repository.claimDueFollowUps({
      now,
      ownerId,
      limit: 3,
    });
    const lines = reminders.map((item) => formatReminder(item));
    const followUps: ClaimedFollowUp[] = [];

    for (const followUp of claimed) {
      const detail = await this.repository.findDetail({
        id: followUp.scheduleItemId,
        slackUserId: ownerId,
      });
      if (!detail || !canNotify({ followUp, item: detail.item })) {
        continue;
      }
      const draft =
        followUp.draft ??
        (await this.draftUsecase.execute({
          item: detail.item,
          followUp,
          recentEvents: detail.events.slice(0, 10),
        }));
      if (draft !== null && followUp.draft === null) {
        const saved = await this.repository.saveFollowUpDraft({
          id: followUp.id,
          claimAt: followUp.deliveryClaimedAt!,
          draft,
        });
        if (!saved) {
          continue;
        }
      }
      // 초안 생성 중 상태가 바뀐 업무는 보내지 않는다. 선점 때의 상태만 믿으면
      // DONE 직후 되돌린 업무의 ON_DONE 연락이 늦게 발송된다.
      const current = await this.repository.findById(followUp.scheduleItemId);
      if (!current || !canNotify({ followUp, item: current })) {
        continue;
      }
      lines.push(formatFollowUp({ item: current, followUp, draft }));
      followUps.push({ followUp, draft });
    }

    if (lines.length === 0) {
      return { skip: true };
    }
    const signatures = [
      ...reminders.map(
        (item) =>
          `reminder:${item.id}:${item.deliveryClaimedAt?.toISOString()}`,
      ),
      ...followUps.map(
        ({ followUp }) =>
          `follow-up:${followUp.id}:${followUp.deliveryClaimedAt?.toISOString()}`,
      ),
    ].sort();
    const guardKeySuffix = createHash('sha256')
      .update(signatures.join('|'))
      .digest('hex');
    return {
      skip: false,
      summaryText: lines.join('\n'),
      guardKeySuffix,
      onDelivered: async () => {
        for (const item of reminders) {
          await this.repository.markReminded({
            id: item.id,
            now: new Date(),
            claimAt: item.deliveryClaimedAt!,
            reminderAt: item.remindAt!,
          });
        }
        for (const { followUp, draft } of followUps) {
          await this.repository.markFollowUpNotified({
            id: followUp.id,
            now: new Date(),
            claimAt: followUp.deliveryClaimedAt!,
            triggerAt: followUp.triggerAt!,
            draft,
          });
        }
      },
    };
  }
}

const canNotify = ({ followUp, item }: FollowUpItemPair): boolean =>
  followUp.trigger === FollowUpTrigger.ON_DONE
    ? item.status === ScheduleStatus.DONE
    : item.status !== ScheduleStatus.SKIPPED;

const sourceLink = (url: string | null | undefined): string => {
  if (!url || !/^https?:\/\/[^<>|\s]+$/i.test(url)) {
    return '';
  }
  return ` <${url}|원문 열기>`;
};

// 「알릴 때예요」는 연락할 일(📣)에만 쓴다 — 내 알림에 쓰면 남에게 연락하라는 말로 읽힌다.
const formatReminder = (item: ScheduleItemRecord): string =>
  `⏰ 지금 챙길 일: ${escapeSlackMrkdwn(item.title)}${formatDueSuffix(item)}${sourceLink(item.sourceUrl)}`;

const formatDueSuffix = ({ dueDate, dueTime }: ScheduleItemRecord): string => {
  if (!dueDate) {
    return '';
  }
  const time = dueTime ? ` ${dueTime}` : '';
  return ` (${toKoreanDate(dueDate)}${time} 마감)`;
};

const formatFollowUp = ({
  item,
  followUp,
  draft,
}: FollowUpMessageInput): string => {
  const heading = `📣 ${escapeSlackMrkdwn(item.title)}: ${escapeSlackMrkdwn(followUp.recipient)}에게 ${escapeSlackMrkdwn(followUp.topic)} 알릴 때예요${sourceLink(item.sourceUrl)}`;
  return draft ? `${heading}\n초안: ${escapeSlackMrkdwn(draft)}` : heading;
};
