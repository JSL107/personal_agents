import { match } from 'ts-pattern';

import {
  isApplicationStatus,
  isWebUrl,
} from '../../agent/job-application/domain/job-application.guard';
import { ApplicationStatus } from '../../agent/job-application/domain/job-application.type';
import {
  comparePlainDate,
  parsePlainDate,
  readPlainDate,
} from '../../agent/vacation/domain/plain-date';
import {
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
} from '../../common/util/type-guard.util';
import { PlainDate } from '../../schedule/domain/schedule.type';

interface RetryTargetRun {
  status: string;
  agentType: string;
  inputSnapshot: unknown;
}

export type RetryTarget =
  | { kind: 'FAILED' }
  | { kind: 'HELD_UNAVAILABLE' }
  | { kind: 'OTHER' }
  | { kind: 'HELD_SCHEDULE'; title: string; dueDate: PlainDate }
  | HeldWriteTarget;

export type HeldWriteTarget =
  | {
      kind: 'HELD_VACATION_REGISTER';
      startDate: PlainDate;
      endDate: PlainDate;
      memo?: string;
      fraction?: 0.5;
    }
  | { kind: 'HELD_VACATION_CANCEL'; usageId: number }
  | {
      kind: 'HELD_JOB_ADD';
      company: string;
      role: string;
      jdUrl?: string;
      status?: ApplicationStatus;
      deadline?: PlainDate;
      appliedAt: PlainDate;
    }
  | { kind: 'HELD_JOB_UPDATE_STATUS'; ref: string; status: ApplicationStatus };

export const isHeldWriteTarget = (
  target: RetryTarget,
): target is HeldWriteTarget => {
  const isHeld =
    target.kind === 'HELD_VACATION_REGISTER' ||
    target.kind === 'HELD_VACATION_CANCEL' ||
    target.kind === 'HELD_JOB_ADD' ||
    target.kind === 'HELD_JOB_UPDATE_STATUS';
  return isHeld;
};

const readRecord = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }
  return value;
};

export const classifyRetryTarget = (run: RetryTargetRun): RetryTarget => {
  if (run.status === 'FAILED') {
    return { kind: 'FAILED' };
  }
  const snapshot = readRecord(run.inputSnapshot);
  const intent = readRecord(snapshot?.parsedIntent);
  const heldWrite = readRecord(intent?.heldWrite);
  if (!intent || !heldWrite) {
    return { kind: 'OTHER' };
  }
  if (run.status !== 'SUCCEEDED') {
    return { kind: 'HELD_UNAVAILABLE' };
  }
  const heldTarget =
    classifyHeldIntent({ agentType: run.agentType, heldWrite, snapshot }) ??
    classifyHeldSchedule({ agentType: run.agentType, heldWrite, intent });
  if (heldTarget === null) {
    return { kind: 'HELD_UNAVAILABLE' };
  }
  return heldTarget;
};

interface HeldIntentInput {
  agentType: string;
  heldWrite: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
}

interface HeldFieldsInput {
  heldIntent: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
}

// 2차부터 보류 시 heldWrite.intent 에 의도 전체를 싣는다. 담당 × 동작 조합으로 갈래를 고른다.
const classifyHeldIntent = ({
  agentType,
  heldWrite,
  snapshot,
}: HeldIntentInput): HeldWriteTarget | null => {
  const heldIntent = readRecord(heldWrite.intent);
  if (!heldIntent || heldIntent.action !== heldWrite.action) {
    return null;
  }
  const fields = { heldIntent, snapshot };
  const target = match({ agentType, action: heldWrite.action })
    .with({ agentType: 'VACATION', action: 'REGISTER' }, () =>
      classifyVacationRegister(fields),
    )
    .with({ agentType: 'VACATION', action: 'CANCEL' }, () =>
      classifyVacationCancel(fields),
    )
    .with({ agentType: 'JOB_APPLICATION', action: 'ADD' }, () =>
      classifyJobAdd(fields),
    )
    .with({ agentType: 'JOB_APPLICATION', action: 'UPDATE_STATUS' }, () =>
      classifyJobUpdateStatus(fields),
    )
    .otherwise(() => null);
  return target;
};

interface HeldScheduleInput {
  agentType: string;
  heldWrite: Record<string, unknown>;
  intent: Record<string, unknown>;
}

// 일정은 1차부터 parsedIntent 자체가 등록 명령({ kind, title, dueDate })이다.
const classifyHeldSchedule = ({
  agentType,
  heldWrite,
  intent,
}: HeldScheduleInput): RetryTarget | null => {
  if (agentType !== 'SCHEDULE' || heldWrite.action !== 'REGISTER') {
    return null;
  }
  if (intent.kind !== 'REGISTER' || !isNonEmptyString(intent.title)) {
    return null;
  }
  const dueDate = validPlainDate(intent.dueDate);
  if (!dueDate) {
    return null;
  }
  return { kind: 'HELD_SCHEDULE', title: intent.title, dueDate };
};

const classifyVacationRegister = ({
  heldIntent,
  snapshot,
}: HeldFieldsInput): HeldWriteTarget | null => {
  const startDate = validPlainDate(heldIntent.startDate);
  const endDate = validPlainDate(heldIntent.endDate);
  const { fraction, memo } = heldIntent;
  if (!startDate || !endDate) {
    return null;
  }
  if (comparePlainDate(startDate, endDate) > 0) {
    return null;
  }
  if (fraction !== undefined && fraction !== 0.5) {
    return null;
  }
  if (memo !== undefined && typeof memo !== 'string') {
    return null;
  }
  if (!validSnapshotDate(snapshot?.asOf)) {
    return null;
  }
  return {
    kind: 'HELD_VACATION_REGISTER',
    startDate,
    endDate,
    ...(fraction === 0.5 ? { fraction } : {}),
    ...(typeof memo === 'string' ? { memo } : {}),
  };
};

const classifyVacationCancel = ({
  heldIntent,
  snapshot,
}: HeldFieldsInput): HeldWriteTarget | null => {
  const { usageId } = heldIntent;
  if (!isPositiveSafeInteger(usageId)) {
    return null;
  }
  if (!validSnapshotDate(snapshot?.asOf)) {
    return null;
  }
  return { kind: 'HELD_VACATION_CANCEL', usageId };
};

const classifyJobAdd = ({
  heldIntent,
  snapshot,
}: HeldFieldsInput): HeldWriteTarget | null => {
  const { company, role, jdUrl, status, deadline } = heldIntent;
  if (!isNonEmptyString(company) || !isNonEmptyString(role)) {
    return null;
  }
  if (jdUrl !== undefined && !isWebUrl(jdUrl)) {
    return null;
  }
  if (status !== undefined && !isApplicationStatus(status)) {
    return null;
  }
  const dueDate = deadline === undefined ? undefined : validPlainDate(deadline);
  if (dueDate === null) {
    return null;
  }
  const appliedAt = validSnapshotDate(snapshot?.today);
  if (!appliedAt) {
    return null;
  }
  return {
    kind: 'HELD_JOB_ADD',
    company,
    role,
    appliedAt,
    ...(jdUrl !== undefined ? { jdUrl } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(dueDate !== undefined ? { deadline: dueDate } : {}),
  };
};

const classifyJobUpdateStatus = ({
  heldIntent,
  snapshot,
}: HeldFieldsInput): HeldWriteTarget | null => {
  const { ref, status } = heldIntent;
  if (!isNonEmptyString(ref) || !isApplicationStatus(status)) {
    return null;
  }
  if (!validSnapshotDate(snapshot?.today)) {
    return null;
  }
  return { kind: 'HELD_JOB_UPDATE_STATUS', ref, status };
};

const validSnapshotDate = (value: unknown): PlainDate | null => {
  if (typeof value === 'string') {
    return parsePlainDate(value);
  }
  return validPlainDate(value);
};

const validPlainDate = (value: unknown): PlainDate | null => {
  const date = readPlainDate(value);
  if (!date || date.year < 100 || date.year > 9999) {
    return null;
  }
  return date;
};
