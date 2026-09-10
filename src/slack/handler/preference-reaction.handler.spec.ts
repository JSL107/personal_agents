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
  client: { conversations: { replies: jest.Mock } };
  context: { botUserId: string; botId: string };
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
    replies: jest
      .fn()
      .mockResolvedValue({ messages: message ? [message] : [] }),
  },
});

const botMessage = (text = '오늘 오전 브리핑 보냅니다', ts = '1.1') => ({
  bot_id: 'B_BOT',
  ts,
  text,
});

const humanMessage = (text = '사람이 쓴 메시지') => ({ ts: '1.1', text });

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
      context: { botUserId: 'BOT', botId: 'B_BOT' },
    });

    expect(client.conversations.replies).not.toHaveBeenCalled();
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
      context: { botUserId: 'BOT', botId: 'B_BOT' },
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
      context: { botUserId: 'BOT', botId: 'B_BOT' },
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
      context: { botUserId: 'BOT', botId: 'B_BOT' },
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  it('메시지 본문이 비어 있으면 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient({ bot_id: 'B_BOT', ts: '1.1', text: '' });

    await getHandler()({
      event: {
        reaction: '+1',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT', botId: 'B_BOT' },
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  it('조건을 모두 만족하면 봇 메시지 본문과 함께 저장한다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient(
      botMessage('오늘 오전 브리핑 보냅니다', '1700000000.0001'),
    );

    await getHandler()({
      event: {
        reaction: 'thumbsup',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1700000000.0001' },
      },
      client,
      context: { botUserId: 'BOT', botId: 'B_BOT' },
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
        context: { botUserId: 'BOT', botId: 'B_BOT' },
      }),
    ).resolves.toBeUndefined();
  });

  // bot_id 유무만 보면 워크스페이스의 다른 봇이 쓴 메시지에 남긴 반응까지 이대리 선호로
  // 저장돼 추론을 오염시킨다.
  it('다른 봇이 쓴 메시지에 달린 반응은 저장하지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = buildClient({
      bot_id: 'B_OTHER',
      ts: '1.1',
      text: '다른 봇의 알림',
    });

    await getHandler()({
      event: {
        reaction: '+1',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1.1' },
      },
      client,
      context: { botUserId: 'BOT', botId: 'B_BOT' },
    });

    expect(repository.record).not.toHaveBeenCalled();
  });

  // 스레드 조회는 반응 대상 외의 메시지도 함께 돌려줄 수 있다. ts 를 맞춰보지 않으면
  // 엉뚱한 본문이 신호로 저장된다.
  it('스레드 조회 결과에서 반응 대상 ts 의 메시지만 쓴다', async () => {
    const { app, getHandler } = buildAppMock();
    const repository = buildRepository();
    new PreferenceReactionHandler(repository).register(app);
    const client = {
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [
            { bot_id: 'B_BOT', ts: '1.0', text: '스레드 부모 — 대상 아님' },
            { bot_id: 'B_BOT', ts: '1.5', text: '반응이 달린 답글' },
          ],
        }),
      },
    };

    await getHandler()({
      event: {
        reaction: '+1',
        user: 'U1',
        item: { type: 'message', channel: 'C1', ts: '1.5' },
      },
      client,
      context: { botUserId: 'BOT', botId: 'B_BOT' },
    });

    expect(repository.record).toHaveBeenCalledWith({
      slackUserId: 'U1',
      channelId: 'C1',
      messageTs: '1.5',
      emoji: '+1',
      messageText: '반응이 달린 답글',
    });
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
      context: { botUserId: 'BOT', botId: 'B_BOT' },
    });

    expect(client.conversations.replies).not.toHaveBeenCalled();
    expect(repository.record).not.toHaveBeenCalled();
  });
});
