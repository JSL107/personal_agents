import { countKstDaysBetween } from '../../common/util/kst-date.util';
import { CLAUDE_AUTH_INCIDENT_KEY } from './notification.type';

export const INCIDENT_QUIET_MS = 30 * 60 * 1000;
const CLAUDE_AUTH_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface IncidentPolicySnapshot {
  openedAt: Date;
  lastSeenAt: Date;
  lastNotifiedAt: Date;
  resolvedAt: Date | null;
}

export interface FailureDecision {
  action: 'OPEN' | 'REMIND' | 'SILENT';
  expiredPrevious: boolean;
  dayCount: number;
}

export const decideOnFailure = ({
  incident,
  key,
  now,
}: {
  incident: IncidentPolicySnapshot | null;
  key: string;
  now: Date;
}): FailureDecision => {
  if (!incident || incident.resolvedAt) {
    return { action: 'OPEN', expiredPrevious: false, dayCount: 1 };
  }
  if (
    key === CLAUDE_AUTH_INCIDENT_KEY &&
    now.getTime() - incident.lastSeenAt.getTime() >= CLAUDE_AUTH_EXPIRY_MS
  ) {
    return { action: 'OPEN', expiredPrevious: true, dayCount: 1 };
  }
  const dayCount = countKstDaysBetween(incident.openedAt, now) + 1;
  if (countKstDaysBetween(incident.lastNotifiedAt, now) > 0) {
    return { action: 'REMIND', expiredPrevious: false, dayCount };
  }
  return { action: 'SILENT', expiredPrevious: false, dayCount };
};

export const normalizeIncidentCause = (message: string): string => {
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine ?? '원인 미상').replace(/\d+(\.\d+)?/g, 'N').slice(0, 200);
};

export const formatIncidentDuration = (durationMs: number): string => {
  const minutes = Math.max(0, Math.floor(durationMs / 60_000));
  if (minutes >= 24 * 60) {
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return `${days}일 ${hours}시간`;
  }
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  }
  return `${minutes}분`;
};
