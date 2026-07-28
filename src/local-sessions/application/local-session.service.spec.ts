import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LocalSessionConfig,
  LocalSessionService,
} from './local-session.service';

describe('LocalSessionService', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');
  let root: string;
  let config: LocalSessionConfig;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'local-sessions-'));
    const claudeSessionsDir = join(root, 'claude-sessions');
    const claudeProjectsDir = join(root, 'claude-projects');
    const codexSessionsDir = join(root, 'codex-sessions');
    mkdirSync(claudeSessionsDir);
    mkdirSync(claudeProjectsDir);
    mkdirSync(codexSessionsDir);
    writeFileSync(
      join(claudeSessionsDir, '100.json'),
      JSON.stringify({ pid: 100, sessionId: 'alive', cwd: '/a', startedAt: 1 }),
    );
    writeFileSync(
      join(claudeSessionsDir, '200.json'),
      JSON.stringify({ pid: 200, sessionId: 'dead', cwd: '/b', startedAt: 1 }),
    );
    config = {
      claudeSessionsDir,
      claudeProjectsDir,
      codexSessionsDir,
      now: () => now,
      isAlive: (pid) => pid === 100, // 200 은 죽은 것으로 취급
    };
  });

  it('두 소스를 합치되 죽은 pid 는 제외한다', () => {
    const service = new LocalSessionService(config);

    const sessions = service.list();

    expect(sessions.map((session) => session.sessionId)).toEqual(['alive']);
  });
});
