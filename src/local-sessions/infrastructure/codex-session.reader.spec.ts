import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCodexSessions } from './codex-session.reader';

describe('readCodexSessions', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
  });

  it('source=codex 세션을 transcriptPath mtime 으로 판정해 파싱한다', () => {
    const transcript = join(sessionsDir, 'rollout.jsonl');
    writeFileSync(transcript, '{}');
    const recent = now.getTime() / 1000 - 5;
    utimesSync(transcript, recent, recent);
    writeFileSync(
      join(sessionsDir, '10867.json'),
      JSON.stringify({
        pid: 10867,
        sessionId: 'codex-1',
        cwd: '/repo/sbe-api',
        transcriptPath: transcript,
        startedAt: 1785124531052,
        source: 'codex',
      }),
    );

    const sessions = readCodexSessions({ sessionsDir, now: () => now });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'codex-1',
      pid: 10867,
      source: 'codex',
      name: 'sbe-api',
      cwd: '/repo/sbe-api',
      state: 'active',
    });
  });

  it('source 가 codex 가 아니면 스킵(노이즈 필터)', () => {
    writeFileSync(
      join(sessionsDir, '999.json'),
      JSON.stringify({
        pid: 999,
        sessionId: 'x',
        cwd: '/x',
        source: 'subagent',
      }),
    );

    expect(readCodexSessions({ sessionsDir, now: () => now })).toEqual([]);
  });
});
