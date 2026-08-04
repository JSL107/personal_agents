import type { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { GithubEventBridge } from './github-event.bridge';
import type { SessionDispatchService } from './session-dispatch.service';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    pid: 111,
    source: 'claude' as const,
    name: 'repo',
    cwd: '/work/repo',
    state: 'idle' as const,
    startedAt: new Date('2026-07-30T00:00:00.000Z'),
    lastActivityAt: new Date('2026-07-30T00:00:00.000Z'),
    ...overrides,
  };
}

function make(sessions: unknown[]) {
  const localSessions = { list: jest.fn().mockReturnValue(sessions) };
  const dispatch = {
    isEnabled: jest.fn().mockReturnValue(true),
    offerToIdleSession: jest.fn().mockResolvedValue(true),
  };
  const bridge = new GithubEventBridge(
    dispatch as unknown as SessionDispatchService,
    localSessions as unknown as LocalSessionService,
  );
  return { bridge, dispatch, localSessions };
}

describe('GithubEventBridge', () => {
  it('PR 오픈 → repo 매칭 유휴 claude 세션에 리뷰 제안', async () => {
    const { bridge, dispatch } = make([makeSession()]);

    await bridge.onPrOpened({ repo: 'me/repo', prNumber: 7, title: '기능' });

    expect(dispatch.offerToIdleSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ sessionId: 's1', source: 'claude' }),
        prRef: 'me/repo#7',
        instruction: expect.stringContaining('me/repo#7'),
        previewText: expect.stringContaining('me/repo#7'),
      }),
    );
  });

  it('CI 실패 → repo 매칭 유휴 세션에 합성 ref로 수정 제안', async () => {
    const { bridge, dispatch } = make([makeSession()]);

    await bridge.onCiFailure({
      repo: 'me/repo',
      checkName: 'verify',
      headSha: 'a1b2c3d4e5',
      htmlUrl: 'https://x',
    });

    expect(dispatch.offerToIdleSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prRef: 'me/repo@a1b2c3d#verify',
        instruction: expect.stringContaining('verify'),
      }),
    );
  });

  it('같은 커밋이라도 체크가 다르면 다른 ref 로 제안한다', async () => {
    const { bridge, dispatch } = make([makeSession()]);
    const base = {
      repo: 'me/repo',
      headSha: 'a1b2c3d4e5',
      htmlUrl: 'https://x',
    };

    await bridge.onCiFailure({ ...base, checkName: 'verify' });
    await bridge.onCiFailure({ ...base, checkName: 'gitguardian' });

    const refs = dispatch.offerToIdleSession.mock.calls.map(
      (call) => (call[0] as { prRef: string }).prRef,
    );
    expect(refs).toEqual([
      'me/repo@a1b2c3d#verify',
      'me/repo@a1b2c3d#gitguardian',
    ]);
  });

  it('비활성이면 세션을 조회하지도, 제안하지도 않는다', async () => {
    const { bridge, dispatch, localSessions } = make([makeSession()]);
    dispatch.isEnabled.mockReturnValue(false);

    await bridge.onPrOpened({ repo: 'me/repo', prNumber: 7, title: 't' });

    expect(localSessions.list).not.toHaveBeenCalled();
    expect(dispatch.offerToIdleSession).not.toHaveBeenCalled();
  });

  it('repo 매칭 유휴 claude 세션이 없으면 제안하지 않는다', async () => {
    const { bridge, dispatch } = make([
      makeSession({ state: 'active' }),
      makeSession({ source: 'codex' }),
      makeSession({ cwd: '/work/other', name: 'other' }),
    ]);

    await bridge.onPrOpened({ repo: 'me/repo', prNumber: 7, title: 't' });

    expect(dispatch.offerToIdleSession).not.toHaveBeenCalled();
  });

  it('매칭 다수면 최근 활동 세션을 고른다', async () => {
    const older = makeSession({
      sessionId: 'old',
      lastActivityAt: new Date('2026-07-30T00:00:00.000Z'),
    });
    const newer = makeSession({
      sessionId: 'new',
      lastActivityAt: new Date('2026-07-30T00:05:00.000Z'),
    });
    const { bridge, dispatch } = make([older, newer]);

    await bridge.onPrOpened({ repo: 'me/repo', prNumber: 7, title: 't' });

    expect(dispatch.offerToIdleSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ sessionId: 'new' }),
      }),
    );
  });
});
