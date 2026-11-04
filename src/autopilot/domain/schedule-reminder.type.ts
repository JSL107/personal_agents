import { ScheduleFollowUpRecord } from '../../schedule/domain/schedule.repository.type';
import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';

export interface ClaimedFollowUp {
  followUp: ScheduleFollowUpRecord;
  draft: string | null;
}

export interface FollowUpItemPair {
  followUp: ScheduleFollowUpRecord;
  item: ScheduleItemRecord;
}

export interface FollowUpMessageInput extends FollowUpItemPair {
  draft: string | null;
}

export interface ReminderLineInput {
  item: ScheduleItemRecord;
  // KST 달력일의 UTC 자정 — `dueDate`(`@db.Date`)와 같은 표현이어야 일수 차이가 정수가 된다.
  today: Date;
}

export interface ReminderDigestInput {
  reminderLines: string[];
  followUpLines: string[];
}

export interface ReminderSectionInput {
  title: string;
  lines: string[];
}
