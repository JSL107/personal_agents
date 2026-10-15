import { WebClient } from '@slack/web-api';

import { findReactedMessage } from './reacted-message.lookup';

interface Stubs {
  client: WebClient;
  replies: jest.Mock;
  history: jest.Mock;
}

const stubClient = (replies: jest.Mock, history = jest.fn()): Stubs => {
  return {
    client: { conversations: { replies, history } } as unknown as WebClient,
    replies,
    history,
  };
};

describe('findReactedMessage', () => {
  it('스레드 답글에 단 반응이면 그 답글을 replies 로 찾는다', async () => {
    // 답글 ts 로 replies 를 부르면 Slack 은 그 답글만 돌려준다(2026-10-15 실측).
    const { client, replies, history } = stubClient(
      jest.fn().mockResolvedValue({
        ok: true,
        messages: [{ ts: '200.000', text: '압정 단 답글' }],
      }),
    );

    const found = await findReactedMessage(client, 'C1', '200.000');

    expect(found?.text).toBe('압정 단 답글');
    expect(replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', ts: '200.000' }),
    );
    expect(history).not.toHaveBeenCalled();
  });

  it('ts 가 맞는 메시지가 없으면 엉뚱한 본문 대신 null 을 돌려준다', async () => {
    const { client } = stubClient(
      jest.fn().mockResolvedValue({
        ok: true,
        messages: [{ ts: '100.000', text: '원글' }],
      }),
    );

    await expect(
      findReactedMessage(client, 'C1', '200.000'),
    ).resolves.toBeNull();
  });

  it('thread_not_found(channel_join 등)면 같은 ts 로 history 를 본다', async () => {
    const { client, history } = stubClient(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('An API error occurred: thread_not_found'), {
          data: { ok: false, error: 'thread_not_found' },
        }),
      ),
      jest.fn().mockResolvedValue({
        ok: true,
        messages: [{ ts: '300.000', text: '님이 채널에 참여했습니다' }],
      }),
    );

    const found = await findReactedMessage(client, 'C1', '300.000');

    expect(found?.text).toBe('님이 채널에 참여했습니다');
    expect(history).toHaveBeenCalledWith(
      expect.objectContaining({ oldest: '300.000', latest: '300.000' }),
    );
  });

  it('그 밖의 오류는 삼키지 않고 던진다', async () => {
    const { client, history } = stubClient(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('not_in_channel'), {
          data: { ok: false, error: 'not_in_channel' },
        }),
      ),
    );

    await expect(findReactedMessage(client, 'C1', '1.0')).rejects.toThrow(
      'not_in_channel',
    );
    expect(history).not.toHaveBeenCalled();
  });
});
