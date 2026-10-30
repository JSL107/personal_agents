import { WebClient } from '@slack/web-api';

import { SlackConversationReader } from './slack-conversation.reader';

describe('SlackConversationReader', () => {
  it('채널 최상위 멘션은 읽지 않고 null 을 돌려준다', async () => {
    const reader = new SlackConversationReader();
    await expect(
      reader.read({
        client: {} as WebClient,
        channelId: 'C1',
        isDirectMessage: false,
        nowMs: 0,
      }),
    ).resolves.toBeNull();
  });

  it('스레드에서 부모와 최근 29개를 보존한다', async () => {
    const replies = jest.fn().mockResolvedValue({
      messages: Array.from({ length: 35 }, (_, index) => ({
        ts: String(index + 1),
        text: '내용',
      })),
    });
    const reader = new SlackConversationReader();
    const messages = await reader.read({
      client: { conversations: { replies } } as unknown as WebClient,
      channelId: 'C1',
      isDirectMessage: false,
      threadTs: '1',
      nowMs: 0,
    });
    expect(messages).toHaveLength(30);
    expect(messages?.[0].ts).toBe('1');
    expect(messages?.[1].ts).toBe('7');
  });
});

it('DM history 와 최근 세 스레드를 합치고 중복을 제거한다', async () => {
  const history = jest.fn().mockResolvedValue({
    messages: [1, 2, 3, 4].map((number) => ({
      ts: String(number),
      reply_count: 1,
      text: '부모',
    })),
  });
  const replies = jest
    .fn()
    .mockImplementation(async ({ ts }: { ts: string }) => ({
      messages: [
        { ts, text: '부모' },
        {
          ts: `${ts}.1`,
          bot_id: 'B',
          text: '답',
          metadata: {
            event_type: 'idaeri_reply',
            event_payload: { agentRunId: 1 },
          },
        },
      ],
    }));
  const reader = new SlackConversationReader();
  const messages = await reader.read({
    client: { conversations: { history, replies } } as unknown as WebClient,
    channelId: 'D',
    isDirectMessage: true,
    messageTs: '10',
    nowMs: 100000000,
  });
  expect(history).toHaveBeenCalledWith({
    channel: 'D',
    limit: 15,
    oldest: '13600',
    latest: '10',
    inclusive: false,
    include_all_metadata: true,
  });
  expect(replies).toHaveBeenCalledTimes(3);
  expect(messages).toHaveLength(7);
  expect(
    messages?.find((message) => message.ts === '4.1')?.metadata?.eventPayload,
  ).toEqual({ agentRunId: 1 });
});

it('조회 실패는 null, 보강 실패는 나머지 기록을 돌려준다', async () => {
  const reader = new SlackConversationReader();
  const history = jest
    .fn()
    .mockResolvedValue({ messages: [{ ts: '1', reply_count: 1 }] });
  const replies = jest.fn().mockRejectedValue(new Error('실패'));
  const client = {
    conversations: { history, replies },
  } as unknown as WebClient;
  await expect(
    reader.read({
      client,
      channelId: 'D',
      isDirectMessage: true,
      nowMs: 100000000,
    }),
  ).resolves.toHaveLength(1);
  history.mockRejectedValueOnce(new Error('실패'));
  await expect(
    reader.read({
      client,
      channelId: 'D',
      isDirectMessage: true,
      nowMs: 100000000,
    }),
  ).resolves.toBeNull();
});

it('selfBotId 는 조회 결과를 캐시하고 실패하면 undefined 를 반환한다', async () => {
  const authTest = jest.fn().mockResolvedValue({ bot_id: 'B' });
  const client = { auth: { test: authTest } } as unknown as WebClient;
  const reader = new SlackConversationReader();
  expect(await reader.selfBotId(client)).toBe('B');
  expect(await reader.selfBotId(client)).toBe('B');
  expect(authTest).toHaveBeenCalledTimes(1);
  const failedReader = new SlackConversationReader();
  authTest.mockRejectedValue(new Error('실패'));
  await expect(failedReader.selfBotId(client)).resolves.toBeUndefined();
});
