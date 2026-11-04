import {
  ScheduleEventRecord,
  ScheduleFollowUpRecord,
} from './schedule.repository.type';
import { ScheduleItemRecord } from './schedule.type';

export interface DraftFollowUpMessageInput {
  item: ScheduleItemRecord;
  followUp: ScheduleFollowUpRecord;
  recentEvents: ScheduleEventRecord[];
}
