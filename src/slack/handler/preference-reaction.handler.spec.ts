import { App } from '@slack/bolt';

import { ReactionSignalRepositoryPort } from '../../preference-profile/domain/port/reaction-signal.repository.port';
import { PreferenceReactionHandler } from './preference-reaction.handler';

type ReactionAddedEvent = {
  reaction: string;
  user?: string;
  item: { type: string; channel: string; ts: string };
};

// context 는 Bolt 가 모든 이벤트에 실어 주는 값이다 — botUserId 로 봇이 스스로 단 반응을
// 걸러내므로 하네스도 실제 호출 형태를 그대로 흉내낸다.
type EventHandler = (args: {
  event: ReactionAddedEvent;
  client: { conversations: { history: jest.Mock } };
  context: { botUserId: string };
}) => Promise<void>;

const buildAppMock = (): {
  app: App;
  getHandler: () => EventHandler;
} => {
  const captured = new Map<string, EventHandler>();
  const app = {
    event: jest.fn((type: string, handler: EventHandler) => {
      captured.set(type, handler);
    }),
  } as unknown as App;
  return {
    app,
    getHandler: () => {
      const handler = captured.get('reaction_added');
      if (!handler) {
        throw new Error('reaction_added handler 미등록');
      }
      return handler;
    },
  };
};

const buildClient = (message: Record<string, unknown> | undefined) => ({
  conversations: {
    history: jest
      .fn()
      .mockResolvedValue({ messages: message ? [message] : [] }),
  },
});

const botMessage = (text = '오늘 오전 브리핑 보냅니다') => ({
  bot_id: 'B_BOT',
  text,
});

const humanMessage = (text = '사람이 쓴 메시지') => ({ text });

const buildRepository = (): jest.Mocked<ReactionSignalRepositoryPort> => ({
  record: jest.fn().mockResolvedValue(undefined),
  recentReactions: jest.fn(),
});

describe('PreferenceReactionHandler', () => {
  it('reaction_added 이벤트를 등록한다', () => {
    const { app } = buildAppMock();
    new PreferenceReactionHandler(buildRepository()).register(app);
    expect(app.event).toHaveBeenCalledWith(
      'reaction_added',
      expect.any(Function),
    );
  });

  it('대상 이모지(+1/-1/thumbsup/thumbsdown)가 아니면 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(botMessage());

    await getHandler()({
      event: {
        reaction: 'eyes',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT' },
    });

    expect(client.conversations.history).not.toHaveBeenCalled();
    expect(repository.record).not.toHaveBeenCalled();
  });

  it('반응 대상이 메시지가 아니면 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(botMessage());

    await getHandler()({
      event: {
        reaction: '+1',
        user: 'U1',
        item: { type: 'file', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT' },
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  it('event.user 가 없으면 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(botMessage());

    await getHandler()({
      event: {
        reaction: '+1',
        item: { type: 'message', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT' },
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  it('사람이 쓴 메시지(bot_id 없음)에 달린 반응은 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(humanMessage());

    await getHandler()({
      event: {
        reaction: '+1',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT' },
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  it('메시지 본문이 비어 있으면 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient({ bot_id: 'B_BOT', text: '' });

    await getHandler()({
      event: {
        reaction: '+1',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT' },
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  it('조건을 모두 만족하면 봇 메시지 본문과 함께 저장한다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(botMessage('오늘 오전 브리핑 보냅니다'));

    await getHandler()({
      event: {
        reaction: 'thumbsup',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1700000000.0001' },
      },
      client,
      context: { botUserId: 'BOT' },
    });

    expect(repository.record).toHaveBeenCalledWith({
      slackUserId: 'U1',
      channelId: 'C1',
      messageTs: '1700000000.0001',
      emoji: 'thumbsup',
      messageText: '오늘 오전 브리핑 보냅니다',
    });
  });

  it('저장 실패는 graceful — 이벤트 처리를 끝낸다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    repository.record.mockRejectedValue(new Error('DB 오류'));
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(botMessage());

    await expect(
      getHandler()({
        event: {
          reaction: '-1',
          user: 'U1',
          item: { type: 'message', channel: 'C1', ts: '1.1' },
        },
        client,
        context: { botUserId: 'BOT' },
      }),
    ).resolves.toBeUndefined();
  });

  // 카드에 👍/👎 를 미리 달아 클릭 한 번으로 받는 방식을 쓰면 그 씨앗이 매번 신호가 된다.
  it('봇이 스스로 단 반응은 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(botMessage());

    await getHandler()({
      event: {
        reaction: '+1',
        user: 'BOT',
        item: { type: 'message', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT' },
    });

    expect(client.conversations.history).not.toHaveBeenCalled();
    expect(repository.record).not.toHaveBeenCalled();
  });
});
