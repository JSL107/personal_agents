import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { LocalSession } from '../domain/local-session.type';
import { deriveSessionState } from '../domain/session-activity';

interface ReadCodexSessionsParams {
  readonly sessionsDir: string;
  readonly now: () => Date;
  readonly isAlive: (pid: number) => boolean;
  readonly procStartsOf: (pids: number[]) => Map<number, string>;
  readonly argsOf: (pids: number[]) => Map<number, string>;
  readonly removeFile: (path: string) => void;
}

interface LiveCodexSessionRecord {
  readonly path: string;
  readonly sessionId: string;
  readonly pid: number;
  readonly cwd: string;
  readonly transcriptPath: string | null;
  readonly startedAt: number | null;
  readonly storedProcStart: string | null;
}

function safeRemove(removeFile: (path: string) => void, path: string): void {
  try {
    removeFile(path);
  } catch {
    // lazy 정리 실패는 세션 조회를 막지 않는다.
  }
}

function isCodexExecCommand(command: string): boolean {
  return /(?:^|\/)codex\s+exec\b/.test(command);
}

export function readCodexSessions(
  params: ReadCodexSessionsParams,
): LocalSession[] {
  const { sessionsDir, now, isAlive, procStartsOf, argsOf, removeFile } =
    params;
  let files: string[];
  try {
    files = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const nowDate = now();
  const liveRecords: LiveCodexSessionRecord[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const path = join(sessionsDir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
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
    // mds 훅은 source==='startup' 세션만 기록하며 record 의 source 는 'codex'.
    // interactive 가 아닌 잡음(subagent/fork)을 배제한다.
    if (record.source !== 'codex') {
      continue;
    }
    let alive: boolean;
    try {
      alive = isAlive(record.pid);
    } catch {
      continue;
    }
    if (!alive) {
      safeRemove(removeFile, path);
      continue;
    }
    liveRecords.push({
      path,
      sessionId: record.sessionId,
      pid: record.pid,
      cwd: typeof record.cwd === 'string' ? record.cwd : '',
      transcriptPath:
        typeof record.transcriptPath === 'string'
          ? record.transcriptPath
          : null,
      startedAt: typeof record.startedAt === 'number' ? record.startedAt : null,
      storedProcStart:
        typeof record.procStart === 'string' ? record.procStart : null,
    });
  }

  const pids = liveRecords.map((record) => record.pid);
  let procStarts: Map<number, string>;
  try {
    procStarts = procStartsOf(pids);
  } catch {
    procStarts = new Map();
  }
  let argsMap: Map<number, string>;
  try {
    argsMap = argsOf(pids);
  } catch {
    argsMap = new Map();
  }

  const sessions: LocalSession[] = [];
  for (const record of liveRecords) {
    const currentProcStart = procStarts.get(record.pid) ?? null;
    if (
      record.storedProcStart !== null &&
      currentProcStart !== null &&
      record.storedProcStart !== currentProcStart
    ) {
      safeRemove(removeFile, record.path);
      continue;
    }
    const command = argsMap.get(record.pid) ?? null;
    if (command !== null && !isCodexExecCommand(command)) {
      continue;
    }
    let mtime: number | null = null;
    if (record.transcriptPath !== null) {
      try {
        mtime = statSync(record.transcriptPath).mtimeMs;
      } catch {
        mtime = null;
      }
    }
    const lastActivityAt = mtime === null ? null : new Date(mtime);
    sessions.push({
      sessionId: record.sessionId,
      pid: record.pid,
      source: 'codex',
      name: basename(record.cwd),
      cwd: record.cwd,
      state: deriveSessionState({
        hasTranscript: mtime !== null,
        lastActivityAt,
        now: nowDate,
      }),
      startedAt:
        record.startedAt === null ? nowDate : new Date(record.startedAt),
      lastActivityAt,
    });
  }
  return sessions;
}
