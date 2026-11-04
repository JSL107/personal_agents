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
