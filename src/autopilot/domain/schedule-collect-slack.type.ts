import { ScheduleItemRecord } from '../../schedule/domain/schedule.type';
import { SlackMention } from '../../slack-collector/domain/slack-collector.type';

export interface SlackSourceEditInput {
  found: ScheduleItemRecord;
  mention: SlackMention;
  now: Date;
}
