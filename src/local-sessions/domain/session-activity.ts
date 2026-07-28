import { LocalSessionState } from './local-session.type';

// mds 와 동일 기준: transcript mtime 이 60초 이내면 active. transcript 부재 시 무조건 idle.
export const ACTIVE_WINDOW_MS = 60_000;

interface DeriveSessionStateParams {
  readonly hasTranscript: boolean;
  readonly lastActivityAt: Date | null;
  readonly now: Date;
}

export function deriveSessionState(
  params: DeriveSessionStateParams,
): LocalSessionState {
  const { hasTranscript, lastActivityAt, now } = params;
  if (!hasTranscript || lastActivityAt === null) {
    return 'idle';
  }
  return now.getTime() - lastActivityAt.getTime() < ACTIVE_WINDOW_MS
    ? 'active'
    : 'idle';
}
