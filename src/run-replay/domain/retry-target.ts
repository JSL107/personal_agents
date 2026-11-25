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
  | { kind: 'HELD_SCHEDULE'; title: string; dueDate: PlainDate };

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
  const date = asRecord(intent?.dueDate);
  if (
    run.status === 'SUCCEEDED' &&
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
