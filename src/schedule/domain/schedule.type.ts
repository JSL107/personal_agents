export enum ScheduleStatus {
  OPEN = 'OPEN',
  DONE = 'DONE',
  SKIPPED = 'SKIPPED',
  IN_PROGRESS = 'IN_PROGRESS',
  CANDIDATE = 'CANDIDATE',
}

export enum ScheduleSource {
  MANUAL = 'MANUAL',
  SLACK_MENTION = 'SLACK_MENTION',
  NOTION_TASK = 'NOTION_TASK',
  GITHUB_ISSUE = 'GITHUB_ISSUE',
}
export enum FollowUpTrigger {
  ON_DONE = 'ON_DONE',
  AT_TIME = 'AT_TIME',
}
export enum ScheduleEventKind {
  CREATED = 'CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  PR_LINKED = 'PR_LINKED',
  PR_MERGED = 'PR_MERGED',
  REMINDED = 'REMINDED',
  FOLLOW_UP_NOTIFIED = 'FOLLOW_UP_NOTIFIED',
  NOTE = 'NOTE',
}
export enum TransitionRejection {
  SAME_STATUS = 'SAME_STATUS',
  TO_CANDIDATE = 'TO_CANDIDATE',
  HOLIDAY_IN_PROGRESS = 'HOLIDAY_IN_PROGRESS',
}
export interface CheckTransitionInput {
  from: ScheduleStatus;
  to: ScheduleStatus;
  isHoliday: boolean;
}
export const checkTransition = ({
  from,
  to,
  isHoliday,
}: CheckTransitionInput): TransitionRejection | null => {
  if (from === to) {
    return TransitionRejection.SAME_STATUS;
  }
  if (to === ScheduleStatus.CANDIDATE) {
    return TransitionRejection.TO_CANDIDATE;
  }
  if (isHoliday && to === ScheduleStatus.IN_PROGRESS) {
    return TransitionRejection.HOLIDAY_IN_PROGRESS;
  }
  return null;
};
export const isUnfinished = (status: ScheduleStatus): boolean =>
  [
    ScheduleStatus.OPEN,
    ScheduleStatus.IN_PROGRESS,
    ScheduleStatus.CANDIDATE,
  ].includes(status);

// 날짜만 다루는 값. JS Date 는 2월 30일 같은 없는 날짜를 조용히 다음 달로 넘기므로
// 파서가 만든 값을 그대로 신뢰하지 않고 이 형태로 고정해 옮긴다.
export interface PlainDate {
  year: number;
  month: number;
  day: number;
}

export interface ScheduleItemRecord {
  id: number;
  slackUserId: string;
  title: string;
  dueDate: Date | null;
  startDate?: Date | null;
  startedAt?: Date | null;
  remindAt?: Date | null;
  remindedAt?: Date | null;
  source?: ScheduleSource;
  sourceKey?: string | null;
  sourceUrl?: string | null;
  candidateExpiresAt?: Date | null;
  deliveryClaimedAt?: Date | null;
  dueTime: string | null;
  linkUrl: string | null;
  memo: string | null;
  status: ScheduleStatus;
  completedAt: Date | null;
  // 공휴일 동기화가 넣은 행인가. 콘솔 달력의 색과 아침 브리핑의 제외가 이 값 하나를 본다
  // (`schedule-briefing.formatter.ts`, `CalendarView.swift`).
  isHoliday: boolean;
}

export type DatedScheduleItemRecord = ScheduleItemRecord & { dueDate: Date };
