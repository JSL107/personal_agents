import {
  FollowUpTrigger,
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from './schedule.type';

export type ScheduleActor = 'USER' | 'COLLECTOR' | 'SWEEP';

export interface TransitionInput {
  id: number;
  slackUserId: string;
  from: ScheduleStatus;
  to: ScheduleStatus;
  now: Date;
  actor: ScheduleActor;
  patch?: ScheduleFieldsPatch;
  expected?: ScheduleDateSnapshot;
}

export interface ScheduleDateSnapshot {
  dueDate: Date | null;
  startDate: Date | null;
  dueTime: string | null;
}

export interface PreparedScheduleFields {
  patch: ScheduleFieldsPatch;
  expected: ScheduleDateSnapshot;
}

export interface ScheduleFieldsPatch {
  title?: string;
  dueDate?: Date;
  dueTime?: string | null;
  startDate?: Date | null;
  remindAt?: Date | null;
}

export interface UpdateScheduleFieldsInput {
  id: number;
  slackUserId: string;
  patch: ScheduleFieldsPatch;
}

export interface PersistScheduleFieldsInput extends UpdateScheduleFieldsInput {
  expected: ScheduleDateSnapshot;
}

export interface CollectedScheduleInput {
  slackUserId: string;
  title: string;
  dueDate: Date | null;
  startDate?: Date | null;
  memo?: string | null;
  source: ScheduleSource;
  sourceKey: string;
  sourceUrl: string | null;
  status: ScheduleStatus;
  candidateExpiresAt?: Date | null;
}

export interface DueClaimInput {
  now: Date;
  ownerId: string;
  limit?: number;
}
export interface MarkRemindedInput {
  id: number;
  now: Date;
  claimAt: Date;
  reminderAt: Date;
}
export interface MarkFollowUpNotifiedInput {
  id: number;
  claimAt: Date;
  triggerAt: Date;
  draft: string | null;
  now: Date;
}

export interface ScheduleFollowUpRecord {
  id: number;
  scheduleItemId: number;
  recipient: string;
  topic: string;
  trigger: FollowUpTrigger;
  triggerAt: Date | null;
  draft: string | null;
  notifiedAt: Date | null;
  sentAt: Date | null;
  deliveryClaimedAt: Date | null;
}

export interface ScheduleEventRecord {
  id: number;
  scheduleItemId: number;
  kind: ScheduleEventKind;
  payload: unknown;
  dedupeKey: string | null;
  occurredAt: Date;
}

export interface AddFollowUpInput {
  scheduleItemId: number;
  slackUserId: string;
  recipient: string;
  topic: string;
  trigger: FollowUpTrigger;
  triggerAt?: Date | null;
}

export interface UpdateFollowUpInput {
  id: number;
  slackUserId: string;
  recipient?: string;
  topic?: string;
  triggerAt?: Date | null;
  sentAt?: Date | null;
}

export interface AddNoteInput {
  scheduleItemId: number;
  slackUserId: string;
  text: string;
  now: Date;
}
export interface AddEventInput {
  scheduleItemId: number;
  kind: ScheduleEventKind;
  payload: unknown;
  dedupeKey?: string | null;
  occurredAt: Date;
}

export interface ScheduleDetail {
  item: import('./schedule.type').ScheduleItemRecord;
  followUps: ScheduleFollowUpRecord[];
  events: ScheduleEventRecord[];
  pendingFollowUpCount: number;
}

export interface FindScheduleDetailInput {
  id: number;
  slackUserId: string;
}
