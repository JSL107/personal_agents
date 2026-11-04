import { formatKstDateTime } from '../../common/util/kst-date.util';
import {
  FormatManagementReplyInput,
  ManagementAction,
} from '../../schedule/domain/management-intent.type';
import {
  FollowUpTrigger,
  ScheduleStatus,
} from '../../schedule/domain/schedule.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const formatKstShort = (date: Date): string => {
  const [day, time] = formatKstDateTime(date).split(' ');
  const [, month, dateOfMonth] = day.split('-').map(Number);
  return `${month}월 ${dateOfMonth}일 ${time}`;
};

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  [ScheduleStatus.OPEN]: '열림',
  [ScheduleStatus.IN_PROGRESS]: '진행 중',
  [ScheduleStatus.DONE]: '완료',
  [ScheduleStatus.SKIPPED]: '건너뜀',
  [ScheduleStatus.CANDIDATE]: '후보',
};

export const formatManagementReply = ({
  title,
  intent,
}: FormatManagementReplyInput): string => {
  const escapedTitle = escapeSlackMrkdwn(title);
  switch (intent.action) {
    case ManagementAction.STATUS:
      return `${escapedTitle} → ${STATUS_LABEL[intent.status ?? ScheduleStatus.OPEN]}${intent.status === ScheduleStatus.IN_PROGRESS ? '으로' : '로'} 바꿨어요`;
    case ManagementAction.REMIND:
      return `${escapedTitle} ${formatKstShort(intent.remindAt!)}에 알려 드릴게요`;
    case ManagementAction.FOLLOW_UP: {
      const timing =
        intent.trigger === FollowUpTrigger.ON_DONE
          ? '끝나면'
          : `${formatKstShort(intent.triggerAt!)}에`;
      return `${escapedTitle} ${timing} ${escapeSlackMrkdwn(intent.recipient!)}에게 ${escapeSlackMrkdwn(intent.topic!)} 알릴 때를 챙길게요`;
    }
    case ManagementAction.NOTE:
      return `${escapedTitle}에 메모를 남겼어요`;
  }
};
