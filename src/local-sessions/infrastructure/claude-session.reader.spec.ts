import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readClaudeSessions } from './claude-session.reader';

describe('readClaudeSessions', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');
  let root: string;
  let sessionsDir: string;
  let projectsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'claude-sessions-'));
    sessionsDir = join(root, 'sessions');
    projectsDir = join(root, 'projects');
    mkdirSync(sessionsDir);
    mkdirSync(projectsDir);
  });

  it('세션 JSON 을 LocalSession 으로 파싱하고 transcript mtime 으로 상태를 판정한다', () => {
    writeFileSync(
      join(sessionsDir, '62687.json'),
      JSON.stringify({
        pid: 62687,
        sessionId: 'sess-abc',
        cwd: '/repo/personal_agents',
        startedAt: 1785125751666,
        name: 'personal-agents-21',
      }),
    );
    const projectDir = join(projectsDir, '-repo-personal-agents');
    mkdirSync(projectDir);
    const transcript = join(projectDir, 'sess-abc.jsonl');
    writeFileSync(transcript, '{}');
    const recent = now.getTime() / 1000 - 5; // 5초 전
    utimesSync(transcript, recent, recent);

    const sessions = readClaudeSessions({
      sessionsDir,
      projectsDir,
      now: () => now,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'sess-abc',
      pid: 62687,
      source: 'claude',
      name: 'personal-agents-21',
      cwd: '/repo/personal_agents',
      state: 'active',
    });
    expect(sessions[0].startedAt.getTime()).toBe(1785125751666);
    expect(sessions[0].lastActivityAt).not.toBeNull();
  });

  it('transcript 가 없으면 idle, lastActivityAt 은 null', () => {
    writeFileSync(
      join(sessionsDir, '8943.json'),
      JSON.stringify({
        pid: 8943,
        sessionId: 'sess-none',
        cwd: '/x',
        startedAt: 1,
      }),
    );

    const sessions = readClaudeSessions({
      sessionsDir,
      projectsDir,
      now: () => now,
    });

    expect(sessions[0].state).toBe('idle');
    expect(sessions[0].lastActivityAt).toBeNull();
  });

  it('sessionsDir 가 없으면 빈 배열(throw 하지 않음)', () => {
    expect(
      readClaudeSessions({
        sessionsDir: join(root, 'nope'),
        projectsDir,
        now: () => now,
      }),
    ).toEqual([]);
  });
});
