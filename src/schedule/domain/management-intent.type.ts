import { DispatchInput } from '../../router/domain/idaeri-router.port';
import {
  FollowUpTrigger,
  ScheduleItemRecord,
  ScheduleStatus,
} from './schedule.type';

export enum ManagementAction {
  STATUS = 'STATUS',
  REMIND = 'REMIND',
  FOLLOW_UP = 'FOLLOW_UP',
  NOTE = 'NOTE',
}

export interface ManagementIntent {
  action: ManagementAction;
  titleQuery: string;
  status?: ScheduleStatus;
  remindAt?: Date;
  recipient?: string;
  topic?: string;
  trigger?: FollowUpTrigger;
  triggerAt?: Date;
  note?: string;
}

export interface FindByTitleInput {
  items: ScheduleItemRecord[];
  query: string;
}

export type TitleMatch =
  | { kind: 'NONE' }
  | { kind: 'ONE'; item: ScheduleItemRecord }
  | { kind: 'MANY'; items: ScheduleItemRecord[] };

export interface ManageScheduleInput {
  input: DispatchInput;
  candidates: ScheduleItemRecord[];
}

export interface ManagementActionMatchInput {
  text: string;
  intent: ManagementIntent;
}

export interface FormatManagementReplyInput {
  title: string;
  intent: ManagementIntent;
}

export interface ManagementWriteInput {
  item: ScheduleItemRecord;
  intent: ManagementIntent;
  slackUserId: string;
}

export interface ManagementWriteResult {
  applied: boolean;
  reason?: string;
}
