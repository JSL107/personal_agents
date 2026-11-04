import {
  ManagementAction,
  ManagementActionMatchInput,
  ManagementIntent,
} from './management-intent.type';
import { FollowUpTrigger, ScheduleStatus } from './schedule.type';

const STATUS_MARKER = /진행\s*중으로|시작\s*$|끝났|완료했|다\s*했/;
const REMIND_MARKER = /(?:알려\s*줘|알림)/;
const TIME_MARKER = /\d{1,2}\s*시|\d{1,2}:\d{2}/;
const FOLLOW_UP_MARKER = /끝나면.*(?:한테|에게).*(?:공유|전달|연락)/;
const NOTE_MARKER = /남겨\s*줘|메모/;

export const hasManagementMarker = (text: string): boolean =>
  STATUS_MARKER.test(text) ||
  (REMIND_MARKER.test(text) && TIME_MARKER.test(text)) ||
  FOLLOW_UP_MARKER.test(text) ||
  NOTE_MARKER.test(text);

export const matchesManagementAction = ({
  text,
  intent,
}: ManagementActionMatchInput): boolean => {
  switch (intent.action) {
    case ManagementAction.STATUS:
      switch (intent.status) {
        case ScheduleStatus.IN_PROGRESS:
          return /진행\s*중으로|시작\s*$/.test(text);
        case ScheduleStatus.DONE:
          return /끝났|완료했|다\s*했/.test(text);
        default:
          return false;
      }
    case ManagementAction.REMIND:
      return REMIND_MARKER.test(text) && TIME_MARKER.test(text);
    case ManagementAction.FOLLOW_UP:
      return FOLLOW_UP_MARKER.test(text);
    case ManagementAction.NOTE:
      return NOTE_MARKER.test(text);
  }
};

const readDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const offset = match[8];
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    year < 100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date <= new Date() ? null : date;
};

export const parseManagementIntent = (
  value: unknown,
): ManagementIntent | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const titleQuery =
    typeof candidate.titleQuery === 'string' ? candidate.titleQuery.trim() : '';
  if (titleQuery.length < 2 || titleQuery.length > 200) {
    return null;
  }
  switch (candidate.action) {
    case ManagementAction.STATUS:
      if (
        !Object.values(ScheduleStatus).includes(
          candidate.status as ScheduleStatus,
        )
      ) {
        return null;
      }
      return {
        action: ManagementAction.STATUS,
        titleQuery,
        status: candidate.status as ScheduleStatus,
      };
    case ManagementAction.REMIND: {
      const remindAt = readDate(candidate.remindAt);
      return remindAt
        ? { action: ManagementAction.REMIND, titleQuery, remindAt }
        : null;
    }
    case ManagementAction.FOLLOW_UP: {
      const recipient =
        typeof candidate.recipient === 'string'
          ? candidate.recipient.trim()
          : '';
      const topic =
        typeof candidate.topic === 'string' ? candidate.topic.trim() : '';
      if (
        !recipient ||
        recipient.length > 100 ||
        !topic ||
        topic.length > 200 ||
        !Object.values(FollowUpTrigger).includes(
          candidate.trigger as FollowUpTrigger,
        )
      ) {
        return null;
      }
      const trigger = candidate.trigger as FollowUpTrigger;
      const triggerAt =
        trigger === FollowUpTrigger.AT_TIME
          ? readDate(candidate.triggerAt)
          : null;
      if (trigger === FollowUpTrigger.AT_TIME && !triggerAt) {
        return null;
      }
      return {
        action: ManagementAction.FOLLOW_UP,
        titleQuery,
        recipient,
        topic,
        trigger,
        ...(triggerAt && { triggerAt }),
      };
    }
    case ManagementAction.NOTE: {
      const note =
        typeof candidate.note === 'string' ? candidate.note.trim() : '';
      return note && note.length <= 500
        ? { action: ManagementAction.NOTE, titleQuery, note }
        : null;
    }
    default:
      return null;
  }
};
