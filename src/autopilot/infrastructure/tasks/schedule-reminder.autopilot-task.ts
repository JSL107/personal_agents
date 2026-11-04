import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { DraftFollowUpMessageUsecase } from '../../../schedule/application/draft-follow-up-message.usecase';
import {
  plainDateToUtcDate,
  todayInKst,
} from '../../../schedule/domain/parse-due-date';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../../../schedule/domain/port/schedule.repository.port';
import {
  FollowUpTrigger,
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
  ReminderDigestInput,
  ReminderLineInput,
  ReminderSectionInput,
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
    const today = plainDateToUtcDate(todayInKst(now));
    const reminderLines = reminders.map((item) =>
      formatReminder({ item, today }),
    );
    const followUpLines: string[] = [];
    const followUps: ClaimedFollowUp[] = [];

    for (const followUp of claimed) {
      const detail = await this.repository.findDetail({
        id: followUp.scheduleItemId,
        slackUserId: ownerId,
      });
      const foundFollowUp = detail?.followUps.find(
        (found) => found.id === followUp.id,
      );
      if (
        !detail ||
        !foundFollowUp ||
        !canNotify({ followUp: foundFollowUp, item: detail.item })
      ) {
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
      // 초안 생성 중 업무 상태나 보냄 표시가 바뀌면 보내지 않는다.
      const current = await this.repository.findDetail({
        id: followUp.scheduleItemId,
        slackUserId: ownerId,
      });
      const currentFollowUp = current?.followUps.find(
        (found) => found.id === followUp.id,
      );
      if (
        !current ||
        !currentFollowUp ||
        !canNotify({ followUp: currentFollowUp, item: current.item })
      ) {
        continue;
      }
      followUpLines.push(
        formatFollowUp({ item: current.item, followUp, draft }),
      );
      followUps.push({ followUp, draft });
    }

    if (reminderLines.length === 0 && followUpLines.length === 0) {
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
      summaryText: formatReminderDigest({ reminderLines, followUpLines }),
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
  followUp.sentAt === null &&
  (followUp.trigger === FollowUpTrigger.ON_DONE
    ? item.status === ScheduleStatus.DONE
    : item.status !== ScheduleStatus.SKIPPED);

const sourceLink = (url: string | null | undefined): string => {
  if (!url || !/^https?:\/\/[^<>|\s]+$/i.test(url)) {
    return '';
  }
  return ` <${url}|원문 열기>`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// 아침 브리핑처럼 칸 제목 + 한 건 한 줄. 한 줄에 종류·제목·마감을 몰아넣으면 읽히지 않았다.
const formatReminderDigest = ({
  reminderLines,
  followUpLines,
}: ReminderDigestInput): string =>
  [
    formatSection({ title: '지금 챙길 일', lines: reminderLines }),
    formatSection({ title: '연락할 때', lines: followUpLines }),
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');

const formatSection = ({ title, lines }: ReminderSectionInput): string =>
  lines.length > 0 ? [`*${title}*`, ...lines].join('\n') : '';

const formatReminder = ({ item, today }: ReminderLineInput): string =>
  `• ${escapeSlackMrkdwn(item.title)}${formatDueLabel({ item, today })}${sourceLink(item.sourceUrl)}`;

const formatDueLabel = ({ item, today }: ReminderLineInput): string => {
  if (!item.dueDate) {
    return '';
  }
  const days = Math.round((item.dueDate.getTime() - today.getTime()) / DAY_MS);
  const time = item.dueTime ? ` ${item.dueTime}` : '';
  if (days < 0) {
    return ` · ${toKoreanDate(item.dueDate)} 마감 지남`;
  }
  const day =
    days === 0 ? '오늘' : days === 1 ? '내일' : toKoreanDate(item.dueDate);
  return ` · ${day}${time} 마감`;
};

const formatFollowUp = ({
  item,
  followUp,
  draft,
}: FollowUpMessageInput): string => {
  const heading = `• ${escapeSlackMrkdwn(followUp.recipient)}에게 ${escapeSlackMrkdwn(followUp.topic)} (${escapeSlackMrkdwn(item.title)})${sourceLink(item.sourceUrl)}`;
  if (!draft) {
    return heading;
  }
  const quoted = escapeSlackMrkdwn(draft)
    .split('\n')
    .map((line) => `  > ${line}`);
  return [heading, ...quoted].join('\n');
};
