import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalSession } from '../domain/local-session.type';
import { readCodexSessions } from './codex-session.reader';

interface ReadSessionsOverrides {
  readonly isAlive?: (pid: number) => boolean;
  readonly procStartsOf?: (pids: number[]) => Map<number, string>;
  readonly removeFile?: (path: string) => void;
}

describe('readCodexSessions', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
  });

  function readSessions(overrides: ReadSessionsOverrides = {}): LocalSession[] {
    const params = {
      sessionsDir,
      now: () => now,
      isAlive: overrides.isAlive ?? (() => true),
      procStartsOf: overrides.procStartsOf ?? (() => new Map()),
      removeFile: overrides.removeFile ?? (() => {}),
    };
    return readCodexSessions(params);
  }

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

    const sessions = readSessions();

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

    expect(readSessions()).toEqual([]);
  });

  it('JSON 내용이 null 이면 스킵한다(throw 하지 않음)', () => {
    writeFileSync(join(sessionsDir, '1.json'), 'null');

    expect(readSessions()).toEqual([]);
  });

  it('저장 procStart 와 현재 procStart 가 다르면 세션 파일을 정리하고 제외한다', () => {
    const sessionPath = join(sessionsDir, '14854.json');
    const removedPaths: string[] = [];
    writeFileSync(
      sessionPath,
      JSON.stringify({
        pid: 14854,
        sessionId: 'reused-pid',
        cwd: '/repo/reused',
        source: 'codex',
        procStart: 'Fri Jul 24 11:18:17 2026',
      }),
    );

    const sessions = readSessions({
      procStartsOf: () => new Map([[14854, 'Wed Jul 29 13:13:52 2026']]),
      removeFile: (path) => removedPaths.push(path),
    });

    expect(sessions).toEqual([]);
    expect(removedPaths).toEqual([sessionPath]);
  });

  it('저장 procStart 와 현재 procStart 가 같으면 세션을 유지한다', () => {
    writeFileSync(
      join(sessionsDir, '15893.json'),
      JSON.stringify({
        pid: 15893,
        sessionId: 'live-codex',
        cwd: '/repo/live',
        source: 'codex',
        procStart: 'Thu Jul 30 15:17:45 2026',
      }),
    );

    const sessions = readSessions({
      procStartsOf: () => new Map([[15893, 'Thu Jul 30 15:17:45 2026']]),
    });

    expect(sessions.map((session) => session.sessionId)).toEqual([
      'live-codex',
    ]);
  });

  it('죽은 pid 세션 파일을 정리하고 제외한다', () => {
    const sessionPath = join(sessionsDir, '200.json');
    const removedPaths: string[] = [];
    writeFileSync(
      sessionPath,
      JSON.stringify({
        pid: 200,
        sessionId: 'dead-codex',
        cwd: '/repo/dead',
        source: 'codex',
      }),
    );

    const sessions = readSessions({
      isAlive: () => false,
      removeFile: (path) => removedPaths.push(path),
    });

    expect(sessions).toEqual([]);
    expect(removedPaths).toEqual([sessionPath]);
  });

  it('현재 procStart 를 조회하지 못하면 재사용 판단을 보류하고 유지한다', () => {
    writeFileSync(
      join(sessionsDir, '300.json'),
      JSON.stringify({
        pid: 300,
        sessionId: 'unknown-current-start',
        cwd: '/repo/unknown-current',
        source: 'codex',
        procStart: 'Thu Jul 30 15:17:45 2026',
      }),
    );

    const sessions = readSessions({
      procStartsOf: () => new Map(),
    });

    expect(sessions.map((session) => session.sessionId)).toEqual([
      'unknown-current-start',
    ]);
  });

  it('저장 procStart 가 없는 구버전 세션 파일은 유지한다', () => {
    writeFileSync(
      join(sessionsDir, '400.json'),
      JSON.stringify({
        pid: 400,
        sessionId: 'legacy-codex',
        cwd: '/repo/legacy',
        source: 'codex',
      }),
    );

    const sessions = readSessions({
      procStartsOf: () => new Map([[400, 'Thu Jul 30 15:17:45 2026']]),
    });

    expect(sessions.map((session) => session.sessionId)).toEqual([
      'legacy-codex',
    ]);
  });
});
