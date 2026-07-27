import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { LocalSession } from '../domain/local-session.type';
import { deriveSessionState } from '../domain/session-activity';

interface ReadCodexSessionsParams {
  readonly sessionsDir: string;
  readonly now: () => Date;
}

export function readCodexSessions(
  params: ReadCodexSessionsParams,
): LocalSession[] {
  const { sessionsDir, now } = params;
  let files: string[];
  try {
    files = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const nowDate = now();
  const sessions: LocalSession[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8'));
    } catch {
      continue;
    }
    if (typeof raw.sessionId !== 'string' || typeof raw.pid !== 'number') {
      continue;
    }
    // mds 훅은 source==='startup' 세션만 기록하며 record 의 source 는 'codex'.
    // interactive 가 아닌 잡음(subagent/fork)을 배제한다.
    if (raw.source !== 'codex') {
      continue;
    }
    const cwd = typeof raw.cwd === 'string' ? raw.cwd : '';
    let mtime: number | null = null;
    if (typeof raw.transcriptPath === 'string') {
      try {
        mtime = statSync(raw.transcriptPath).mtimeMs;
      } catch {
        mtime = null;
      }
    }
    const lastActivityAt = mtime === null ? null : new Date(mtime);
    sessions.push({
      sessionId: raw.sessionId,
      pid: raw.pid,
      source: 'codex',
      name: basename(cwd),
      cwd,
      state: deriveSessionState({
        hasTranscript: mtime !== null,
        lastActivityAt,
        now: nowDate,
      }),
      startedAt:
        typeof raw.startedAt === 'number' ? new Date(raw.startedAt) : nowDate,
      lastActivityAt,
    });
  }
  return sessions;
}
