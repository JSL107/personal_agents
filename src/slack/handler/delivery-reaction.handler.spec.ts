import { App } from '@slack/bolt';

import { SlackDeliveryRepositoryPort } from '../domain/port/slack-delivery.repository.port';
import { DeliveryReactionHandler } from './delivery-reaction.handler';

type ReactionEvent = {
  user?: string;
  item: { type: string; channel: string; ts: string };
};

type EventHandler = (input: {
  event: ReactionEvent;
  context: { botUserId: string };
}) => Promise<void>;

const buildHarness = () => {
  let handler: EventHandler | undefined;
  const app = {
    event: jest.fn((_name: string, callback: EventHandler) => {
      handler = callback;
    }),
  } as unknown as App;
  const incrementReactionCount = jest.fn().mockResolvedValue(1);
  const repository = {
    incrementReactionCount,
  } as unknown as SlackDeliveryRepositoryPort;
  new DeliveryReactionHandler(repository).register(app);
  if (!handler) {
    throw new Error('reaction_added handler 미등록');
  }
  return { app, handler, incrementReactionCount };
};

const baseEvent: ReactionEvent = {
  user: 'U_USER',
  item: { type: 'message', channel: 'C_CHANNEL', ts: '100.001' },
};

describe('DeliveryReactionHandler', () => {
  it('reaction_added 의 메시지 channel/ts 로 집계한다', async () => {
    const { app, handler, incrementReactionCount } = buildHarness();

    await handler({ event: baseEvent, context: { botUserId: 'U_BOT' } });

    expect(app.event).toHaveBeenCalledWith(
      'reaction_added',
      expect.any(Function),
    );
    expect(incrementReactionCount).toHaveBeenCalledWith({
      channelId: 'C_CHANNEL',
      messageTs: '100.001',
    });
  });

  it.each([
    { ...baseEvent, user: 'U_BOT' },
    { ...baseEvent, user: undefined },
    { ...baseEvent, item: { ...baseEvent.item, type: 'file' } },
  ])('봇 반응, 사용자 누락, 비메시지 반응은 건너뛴다', async (event) => {
    const { handler, incrementReactionCount } = buildHarness();

    await handler({ event, context: { botUserId: 'U_BOT' } });

    expect(incrementReactionCount).not.toHaveBeenCalled();
  });

  it('저장 실패해도 이벤트 처리를 끝낸다', async () => {
    const { handler, incrementReactionCount } = buildHarness();
    incrementReactionCount.mockRejectedValue(new Error('DB 오류'));

    await expect(
      handler({ event: baseEvent, context: { botUserId: 'U_BOT' } }),
    ).resolves.toBeUndefined();
  });
});
