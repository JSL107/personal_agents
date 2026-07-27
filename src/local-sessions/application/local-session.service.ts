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

export function defaultLocalSessionConfig(): LocalSessionConfig {
  const home = homedir();
  return {
    claudeSessionsDir: join(home, '.claude', 'sessions'),
    claudeProjectsDir: join(home, '.claude', 'projects'),
    codexSessionsDir: join(home, '.mds', 'codex-sessions'),
    now: () => new Date(),
    isAlive: defaultIsAlive,
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
    } = this.config;
    const sessions: LocalSession[] = [
      ...readClaudeSessions({
        sessionsDir: claudeSessionsDir,
        projectsDir: claudeProjectsDir,
        now,
      }),
      ...readCodexSessions({ sessionsDir: codexSessionsDir, now }),
    ];
    return sessions.filter((session) => isAlive(session.pid));
  }
}
