import { ConsoleSession } from '../domain/console.type';
import { diffSessions } from './session-diff';

const base: ConsoleSession = {
  sessionId: 's1',
  pid: 1,
  source: 'claude',
  name: 'r',
  cwd: '/r',
  state: 'idle',
  startedAt: '2026-07-27T00:00:00.000Z',
  lastActivityAt: null,
};

describe('diffSessions', () => {
  it('신규 세션은 session.opened', () => {
    expect(diffSessions([], [base])).toEqual([
      { type: 'session.opened', session: base },
    ]);
  });

  it('상태/활동이 바뀌면 session.updated', () => {
    const next = { ...base, state: 'active' as const };
    expect(diffSessions([base], [next])).toEqual([
      { type: 'session.updated', session: next },
    ]);
  });

  it('변화 없으면 이벤트 없음', () => {
    expect(diffSessions([base], [base])).toEqual([]);
  });

  it('사라진 세션은 session.closed(sessionId)', () => {
    expect(diffSessions([base], [])).toEqual([
      { type: 'session.closed', sessionId: 's1' },
    ]);
  });
});
