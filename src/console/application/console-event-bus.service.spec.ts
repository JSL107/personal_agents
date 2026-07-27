import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';

import { ConsoleAgentState } from '../domain/console.type';
import { ConsoleEventBus } from './console-event-bus.service';

describe('ConsoleEventBus', () => {
  it('publish 한 이벤트를 구독자가 받는다', async () => {
    const bus = new ConsoleEventBus();
    const received = firstValueFrom(bus.stream().pipe(take(1)));
    bus.publish({
      type: 'state.changed',
      agentType: 'PM',
      state: ConsoleAgentState.IN_PROGRESS,
    });
    await expect(received).resolves.toMatchObject({
      type: 'state.changed',
      agentType: 'PM',
    });
  });

  it('여러 이벤트를 순서대로 흘린다', async () => {
    const bus = new ConsoleEventBus();
    const collected = firstValueFrom(bus.stream().pipe(take(2), toArray()));
    bus.publish({
      type: 'approval.opened',
      approval: { id: 'a1', agentType: 'BE', title: 't', createdAt: 'now' },
    });
    bus.publish({
      type: 'approval.resolved',
      approval: { id: 'a1', agentType: 'BE', title: 't', createdAt: 'now' },
    });
    const events = await collected;
    expect(events.map((event) => event.type)).toEqual([
      'approval.opened',
      'approval.resolved',
    ]);
  });

  it('구독 이전에 발행된 이벤트는 재전달하지 않는다(Subject 의미)', async () => {
    const bus = new ConsoleEventBus();
    bus.publish({
      type: 'state.changed',
      agentType: 'PM',
      state: ConsoleAgentState.COMPLETED,
    });
    const next = firstValueFrom(bus.stream().pipe(take(1)));
    bus.publish({
      type: 'state.changed',
      agentType: 'CTO',
      state: ConsoleAgentState.IN_PROGRESS,
    });
    await expect(next).resolves.toMatchObject({ agentType: 'CTO' });
  });
});
