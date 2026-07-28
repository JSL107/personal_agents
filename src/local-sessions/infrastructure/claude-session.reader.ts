import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { LocalSession } from '../domain/local-session.type';
import { deriveSessionState } from '../domain/session-activity';

interface ReadClaudeSessionsParams {
  readonly sessionsDir: string;
  readonly projectsDir: string;
  readonly now: () => Date;
}

// projects/*/<sessionId>.jsonl 을 한 번 훑어 sessionId → 최신 mtime(ms) 맵을 만든다.
function buildTranscriptMtimeMap(projectsDir: string): Map<string, number> {
  const map = new Map<string, number>();
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir);
  } catch {
    return map;
  }
  for (const projectDir of projectDirs) {
    const fullDir = join(projectsDir, projectDir);
    let files: string[];
    try {
      files = readdirSync(fullDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) {
        continue;
      }
      const sessionId = file.slice(0, file.length - '.jsonl'.length);
      try {
        const mtime = statSync(join(fullDir, file)).mtimeMs;
        const existing = map.get(sessionId);
        if (existing === undefined || mtime > existing) {
          map.set(sessionId, mtime);
        }
      } catch {
        continue;
      }
    }
  }
  return map;
}

export function readClaudeSessions(
  params: ReadClaudeSessionsParams,
): LocalSession[] {
  const { sessionsDir, projectsDir, now } = params;
  let files: string[];
  try {
    files = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const transcriptMtime = buildTranscriptMtimeMap(projectsDir);
  const nowDate = now();
  const sessions: LocalSession[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8'));
    } catch {
      continue;
    }
    if (raw === null || typeof raw !== 'object') {
      continue;
    }
    const record = raw as Record<string, unknown>;
    if (
      typeof record.sessionId !== 'string' ||
      typeof record.pid !== 'number'
    ) {
      continue;
    }
    const cwd = typeof record.cwd === 'string' ? record.cwd : '';
    const mtime = transcriptMtime.get(record.sessionId) ?? null;
    const lastActivityAt = mtime === null ? null : new Date(mtime);
    sessions.push({
      sessionId: record.sessionId,
      pid: record.pid,
      source: 'claude',
      name:
        typeof record.name === 'string' && record.name.length > 0
          ? record.name
          : basename(cwd),
      cwd,
      state: deriveSessionState({
        hasTranscript: mtime !== null,
        lastActivityAt,
        now: nowDate,
      }),
      startedAt:
        typeof record.startedAt === 'number'
          ? new Date(record.startedAt)
          : nowDate,
      lastActivityAt,
    });
  }
  return sessions;
}
