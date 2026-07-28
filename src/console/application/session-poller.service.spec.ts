import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { LocalSession } from '../../local-sessions/domain/local-session.type';
import { ConsoleEvent } from '../domain/console.type';
import { ConsoleEventBus } from './console-event-bus.service';
import { SessionPollerService } from './session-poller.service';

function local(sessionId: string, state: 'active' | 'idle'): LocalSession {
  return {
    sessionId,
    pid: 1,
    source: 'claude',
    name: 'r',
    cwd: '/r',
    state,
    startedAt: new Date('2026-07-27T00:00:00Z'),
    lastActivityAt: null,
  };
}

describe('SessionPollerService', () => {
  let list: jest.Mock;
  let published: ConsoleEvent[];
  let poller: SessionPollerService;

  beforeEach(() => {
    list = jest.fn().mockReturnValue([]);
    published = [];
    const bus = { publish: (event: ConsoleEvent) => published.push(event) };
    poller = new SessionPollerService(
      { list } as unknown as LocalSessionService,
      bus as unknown as ConsoleEventBus,
    );
  });

  it('prime 는 이벤트를 발행하지 않는다(스냅샷과 중복 방지)', () => {
    list.mockReturnValue([local('s1', 'idle')]);
    poller.prime();
    expect(published).toEqual([]);
  });

  it('pollOnce 는 prime 이후 변화를 이벤트로 발행한다', () => {
    list.mockReturnValue([local('s1', 'idle')]);
    poller.prime();
    list.mockReturnValue([local('s1', 'active')]);
    poller.pollOnce();
    expect(published).toEqual([
      {
        type: 'session.updated',
        session: expect.objectContaining({ sessionId: 's1', state: 'active' }),
      },
    ]);
  });

  it('pollOnce 중 list() 가 throw 해도 던지지 않고, baseline 을 유지한 채 발행하지 않는다', () => {
    list.mockReturnValue([local('s1', 'idle')]);
    poller.prime();
    list.mockImplementation(() => {
      throw new Error('디스크 읽기 실패');
    });

    expect(() => poller.pollOnce()).not.toThrow();
    expect(published).toEqual([]);

    // baseline(previous) 이 살아있는지 — 다음 정상 tick 에서 원래 diff 가 그대로 나오는지로 검증한다.
    list.mockReturnValue([local('s1', 'active')]);
    poller.pollOnce();
    expect(published).toEqual([
      {
        type: 'session.updated',
        session: expect.objectContaining({ sessionId: 's1', state: 'active' }),
      },
    ]);
  });
});
