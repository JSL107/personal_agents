import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { ConsoleSession } from '../../console/domain/console.type';
import { IdleTransitionWatcher } from './idle-transition.watcher';
import { SessionDispatchService } from './session-dispatch.service';

function session(state: ConsoleSession['state']): ConsoleSession {
  return {
    sessionId: 'session-1',
    pid: 1234,
    source: 'claude',
    name: 'idaeri-session',
    cwd: '/workspace/idaeri',
    state,
    startedAt: '2026-07-30T00:00:00.000Z',
    lastActivityAt: '2026-07-30T00:01:00.000Z',
  };
}

function make(): {
  readonly dispatch: Pick<SessionDispatchService, 'onSessionBecameIdle'>;
  readonly bus: ConsoleEventBus;
} {
  const dispatch: Pick<SessionDispatchService, 'onSessionBecameIdle'> = {
    onSessionBecameIdle: jest.fn().mockResolvedValue(undefined),
  };
  const bus = new ConsoleEventBus();
  const watcher = new IdleTransitionWatcher(
    bus,
    dispatch as unknown as SessionDispatchService,
  );
  watcher.onApplicationBootstrap();

  return { dispatch, bus };
}

describe('IdleTransitionWatcher', () => {
  it('active에서 idle로 전이하면 dispatch한다', () => {
    const { dispatch, bus } = make();

    bus.publish({ type: 'session.updated', session: session('active') });
    bus.publish({ type: 'session.updated', session: session('idle') });

    expect(dispatch.onSessionBecameIdle).toHaveBeenCalledTimes(1);
    expect(dispatch.onSessionBecameIdle).toHaveBeenCalledWith(session('idle'));
  });

  it('첫 관측이 idle이면 dispatch하지 않는다', () => {
    const { dispatch, bus } = make();

    bus.publish({ type: 'session.opened', session: session('idle') });

    expect(dispatch.onSessionBecameIdle).not.toHaveBeenCalled();
  });

  it('idle 상태가 유지되면 중복 dispatch하지 않는다', () => {
    const { dispatch, bus } = make();

    bus.publish({ type: 'session.updated', session: session('active') });
    bus.publish({ type: 'session.updated', session: session('idle') });
    bus.publish({ type: 'session.updated', session: session('idle') });

    expect(dispatch.onSessionBecameIdle).toHaveBeenCalledTimes(1);
  });

  it('세션 외 이벤트는 무시한다', () => {
    const { dispatch, bus } = make();

    bus.publish({
      type: 'run.started',
      run: {
        id: 'run-1',
        agentType: 'PM',
        status: 'RUNNING',
        parentId: null,
        startedAt: '2026-07-30T00:00:00.000Z',
        finishedAt: null,
      },
    });

    expect(dispatch.onSessionBecameIdle).not.toHaveBeenCalled();
  });

  it('session.closed 뒤 idle 관측은 새 첫 관측으로 처리한다', () => {
    const { dispatch, bus } = make();

    bus.publish({ type: 'session.updated', session: session('active') });
    bus.publish({ type: 'session.closed', sessionId: 'session-1' });
    bus.publish({ type: 'session.opened', session: session('idle') });

    expect(dispatch.onSessionBecameIdle).not.toHaveBeenCalled();
  });
});
