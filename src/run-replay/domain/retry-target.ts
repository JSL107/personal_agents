import {
  APPLICATION_STATUSES,
  ApplicationStatus,
} from '../../agent/job-application/domain/job-application.type';
import {
  comparePlainDate,
  parsePlainDate,
} from '../../agent/vacation/domain/plain-date';
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

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

export const classifyRetryTarget = (run: RetryTargetRun): RetryTarget => {
  if (run.status === 'FAILED') {
    return { kind: 'FAILED' };
  }
  const snapshot = asRecord(run.inputSnapshot);
  const intent = asRecord(snapshot?.parsedIntent);
  const heldWrite = asRecord(intent?.heldWrite);
  if (!heldWrite) {
    return { kind: 'OTHER' };
  }
  if (run.status !== 'SUCCEEDED') {
    return { kind: 'HELD_UNAVAILABLE' };
  }
  const heldIntent = asRecord(heldWrite.intent);
  if (heldIntent && heldIntent.action === heldWrite.action) {
    const heldTarget = classifyHeldIntent({
      agentType: run.agentType,
      heldWrite,
      heldIntent,
      snapshot,
    });
    if (heldTarget !== null) {
      return heldTarget;
    }
  }
  const date = asRecord(intent?.dueDate);
  if (
    run.agentType === 'SCHEDULE' &&
    heldWrite.action === 'REGISTER' &&
    intent?.kind === 'REGISTER' &&
    typeof intent.title === 'string' &&
    intent.title.trim().length > 0 &&
    date &&
    isValidDate(date)
  ) {
    return {
      kind: 'HELD_SCHEDULE',
      title: intent.title,
      dueDate: date as unknown as PlainDate,
    };
  }
  return { kind: 'HELD_UNAVAILABLE' };
};

interface HeldIntentInput {
  agentType: string;
  heldWrite: Record<string, unknown>;
  heldIntent: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
}

const classifyHeldIntent = ({
  agentType,
  heldWrite,
  heldIntent,
  snapshot,
}: HeldIntentInput): RetryTarget | null => {
  if (agentType === 'VACATION' && heldWrite.action === 'REGISTER') {
    const startDate = validPlainDate(heldIntent.startDate);
    const endDate = validPlainDate(heldIntent.endDate);
    const fraction = heldIntent.fraction;
    const memo = heldIntent.memo;
    if (
      !startDate ||
      !endDate ||
      comparePlainDate(startDate, endDate) > 0 ||
      (fraction !== undefined && fraction !== 0.5) ||
      (memo !== undefined && typeof memo !== 'string') ||
      !validSnapshotDate(snapshot?.asOf)
    ) {
      return null;
    }
    return {
      kind: 'HELD_VACATION_REGISTER',
      startDate,
      endDate,
      ...(fraction === 0.5 ? { fraction } : {}),
      ...(typeof memo === 'string' ? { memo } : {}),
    };
  }
  if (agentType === 'VACATION' && heldWrite.action === 'CANCEL') {
    const usageId = heldIntent.usageId;
    if (
      !Number.isSafeInteger(usageId) ||
      (usageId as number) <= 0 ||
      !validSnapshotDate(snapshot?.asOf)
    ) {
      return null;
    }
    return { kind: 'HELD_VACATION_CANCEL', usageId: usageId as number };
  }
  if (agentType === 'JOB_APPLICATION' && heldWrite.action === 'ADD') {
    const { company, role, jdUrl, status, deadline } = heldIntent;
    const appliedAt = validSnapshotDate(snapshot?.today);
    const dueDate =
      deadline === undefined ? undefined : validPlainDate(deadline);
    if (
      !nonEmptyString(company) ||
      !nonEmptyString(role) ||
      (jdUrl !== undefined && !validJobUrl(jdUrl)) ||
      (status !== undefined && !validStatus(status)) ||
      (deadline !== undefined && !dueDate) ||
      !appliedAt
    ) {
      return null;
    }
    return {
      kind: 'HELD_JOB_ADD',
      company,
      role,
      appliedAt,
      ...(typeof jdUrl === 'string' ? { jdUrl } : {}),
      ...(status !== undefined ? { status: status as ApplicationStatus } : {}),
      ...(dueDate ? { deadline: dueDate } : {}),
    };
  }
  if (agentType === 'JOB_APPLICATION' && heldWrite.action === 'UPDATE_STATUS') {
    const { ref, status } = heldIntent;
    if (
      !nonEmptyString(ref) ||
      !validStatus(status) ||
      !validSnapshotDate(snapshot?.today)
    ) {
      return null;
    }
    return { kind: 'HELD_JOB_UPDATE_STATUS', ref, status };
  }
  return null;
};

const nonEmptyString = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  return value.trim().length > 0;
};

const validStatus = (value: unknown): value is ApplicationStatus => {
  if (typeof value !== 'string') {
    return false;
  }
  return APPLICATION_STATUSES.includes(value as ApplicationStatus);
};

const validJobUrl = (value: unknown): value is string => {
  if (!nonEmptyString(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    const isWebUrl = url.protocol === 'https:' || url.protocol === 'http:';
    return isWebUrl;
  } catch {
    return false;
  }
};

const validSnapshotDate = (value: unknown): PlainDate | null => {
  if (typeof value === 'string') {
    return parsePlainDate(value);
  }
  return validPlainDate(value);
};

const validPlainDate = (value: unknown): PlainDate | null => {
  const date = asRecord(value);
  if (!date || !isValidDate(date)) {
    return null;
  }
  return date as unknown as PlainDate;
};

const isValidDate = (date: Record<string, unknown>): boolean => {
  const { year, month, day } = date;
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    typeof day !== 'number' ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 100 ||
    year > 9999
  ) {
    return false;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};
