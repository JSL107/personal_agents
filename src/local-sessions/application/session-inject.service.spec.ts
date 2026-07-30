import type { EnqueueDeps } from '../domain/inject-queue';
import type { LocalSession } from '../domain/local-session.type';
import type { LocalSessionService } from './local-session.service';
import { SessionInjectService } from './session-inject.service';

function makeSession(overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    sessionId: 's1',
    pid: 4242,
    source: 'claude',
    name: 'repo',
    cwd: '/repo',
    state: 'active',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

function makeService(sessions: LocalSession[]) {
  const written: Array<{ path: string; data: string }> = [];
  const enqueueDeps: EnqueueDeps = {
    injectDir: '/q',
    now: () => 1000,
    seq: () => 'a',
    mkdir: () => {},
    writeFile: (path, data) => {
      written.push({ path, data });
    },
  };
  const localSessions = {
    list: () => sessions,
  } as unknown as LocalSessionService;
  return {
    service: new SessionInjectService(localSessions, enqueueDeps),
    written,
  };
}

describe('SessionInjectService', () => {
  it('세션 존재 + 텍스트 있으면 enqueue 후 ok', () => {
    const { service, written } = makeService([makeSession()]);
    const result = service.inject('s1', '테스트 고쳐');
    expect(result).toEqual({ ok: true });
    expect(written).toHaveLength(1);
    const stored = JSON.parse(written[0].data);
    expect(stored.instruction).toBe('테스트 고쳐');
    expect(stored.sessionId).toBe('s1');
    expect(stored.source).toBe('claude');
  });

  it('빈/공백 텍스트는 EMPTY_INSTRUCTION, enqueue 안 함', () => {
    const { service, written } = makeService([makeSession()]);
    expect(service.inject('s1', '   ')).toEqual({
      ok: false,
      reason: 'EMPTY_INSTRUCTION',
    });
    expect(written).toHaveLength(0);
  });

  it('없는 세션은 SESSION_NOT_FOUND', () => {
    const { service, written } = makeService([makeSession()]);
    expect(service.inject('nope', '고쳐')).toEqual({
      ok: false,
      reason: 'SESSION_NOT_FOUND',
    });
    expect(written).toHaveLength(0);
  });

  it('세션은 찾았으나 pid 가 0 이면 SESSION_NOT_FOUND(false-success 방지)', () => {
    const { service, written } = makeService([makeSession({ pid: 0 })]);
    expect(service.inject('s1', '고쳐')).toEqual({
      ok: false,
      reason: 'SESSION_NOT_FOUND',
    });
    expect(written).toHaveLength(0);
  });

  it('codex 세션이면 source=codex 로 enqueue', () => {
    const { service, written } = makeService([
      makeSession({ sessionId: 'cx1', source: 'codex', pid: 5555 }),
    ]);
    service.inject('cx1', '빌드 확인');
    expect(JSON.parse(written[0].data).source).toBe('codex');
  });
});
