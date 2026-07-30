import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { LocalSession } from '../domain/local-session.type';
import { readClaudeSessions } from '../infrastructure/claude-session.reader';
import { readCodexSessions } from '../infrastructure/codex-session.reader';

export interface LocalSessionConfig {
  readonly claudeSessionsDir: string;
  readonly claudeProjectsDir: string;
  readonly codexSessionsDir: string;
  readonly now: () => Date;
  readonly isAlive: (pid: number) => boolean;
  readonly procStartsOf: (pids: number[]) => Map<number, string>;
  readonly argsOf: (pids: number[]) => Map<number, string>;
  readonly removeFile: (path: string) => void;
}

export const LOCAL_SESSION_CONFIG = Symbol('LOCAL_SESSION_CONFIG');

// signal 0 은 프로세스에 실제 신호를 보내지 않고 존재/권한만 확인한다.
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultProcStartsOf(pids: number[]): Map<number, string> {
  if (pids.length === 0) {
    return new Map();
  }
  let output: string;
  try {
    output = execFileSync('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], {
      encoding: 'utf8',
    });
  } catch {
    return new Map();
  }
  const procStarts = new Map<number, string>();
  for (const line of output.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    const separatorIndex = trimmedLine.indexOf(' ');
    if (separatorIndex === -1) {
      continue;
    }
    const pid = Number(trimmedLine.slice(0, separatorIndex));
    const procStart = trimmedLine.slice(separatorIndex + 1).trim();
    if (!Number.isSafeInteger(pid) || procStart.length === 0) {
      continue;
    }
    procStarts.set(pid, procStart);
  }
  return procStarts;
}

function defaultArgsOf(pids: number[]): Map<number, string> {
  if (pids.length === 0) {
    return new Map();
  }
  let output: string;
  try {
    output = execFileSync('ps', ['-o', 'pid=,args=', '-p', pids.join(',')], {
      encoding: 'utf8',
    });
  } catch {
    return new Map();
  }
  const argsMap = new Map<number, string>();
  for (const line of output.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    const separatorIndex = trimmedLine.indexOf(' ');
    if (separatorIndex === -1) {
      continue;
    }
    const pid = Number(trimmedLine.slice(0, separatorIndex));
    const command = trimmedLine.slice(separatorIndex + 1).trim();
    if (!Number.isSafeInteger(pid) || command.length === 0) {
      continue;
    }
    argsMap.set(pid, command);
  }
  return argsMap;
}

function defaultRemoveFile(path: string): void {
  unlinkSync(path);
}

export function defaultLocalSessionConfig(): LocalSessionConfig {
  const home = homedir();
  return {
    claudeSessionsDir: join(home, '.claude', 'sessions'),
    claudeProjectsDir: join(home, '.claude', 'projects'),
    codexSessionsDir: join(home, '.mds', 'codex-sessions'),
    now: () => new Date(),
    isAlive: defaultIsAlive,
    procStartsOf: defaultProcStartsOf,
    argsOf: defaultArgsOf,
    removeFile: defaultRemoveFile,
  };
}

// 상태 저장 없음 — 매 list() 호출마다 파일을 다시 읽는다(mds 와 동일한 stateless 조회).
@Injectable()
export class LocalSessionService {
  constructor(
    @Inject(LOCAL_SESSION_CONFIG)
    private readonly config: LocalSessionConfig,
  ) {}

  list(): LocalSession[] {
    const {
      claudeSessionsDir,
      claudeProjectsDir,
      codexSessionsDir,
      now,
      isAlive,
      procStartsOf,
      argsOf,
      removeFile,
    } = this.config;
    const claudeSessions = readClaudeSessions({
      sessionsDir: claudeSessionsDir,
      projectsDir: claudeProjectsDir,
      now,
    }).filter((session) => isAlive(session.pid));
    const codexSessions = readCodexSessions({
      sessionsDir: codexSessionsDir,
      now,
      isAlive,
      procStartsOf,
      argsOf,
      removeFile,
    });
    return [...claudeSessions, ...codexSessions];
  }
}
