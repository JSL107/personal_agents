import { LocalSession } from '../../local-sessions/domain/local-session.type';
import { toConsoleSession } from './console-mappers';

describe('toConsoleSession', () => {
  it('Date 를 ISO 문자열로, null 활동을 null 로 매핑한다', () => {
    const local: LocalSession = {
      sessionId: 's1',
      pid: 42,
      source: 'claude',
      name: 'repo-1',
      cwd: '/repo',
      state: 'active',
      startedAt: new Date('2026-07-27T00:00:00.000Z'),
      lastActivityAt: new Date('2026-07-27T00:00:30.000Z'),
    };

    expect(toConsoleSession(local)).toEqual({
      sessionId: 's1',
      pid: 42,
      source: 'claude',
      name: 'repo-1',
      cwd: '/repo',
      state: 'active',
      startedAt: '2026-07-27T00:00:00.000Z',
      lastActivityAt: '2026-07-27T00:00:30.000Z',
    });
    expect(
      toConsoleSession({ ...local, lastActivityAt: null }).lastActivityAt,
    ).toBeNull();
  });
});
