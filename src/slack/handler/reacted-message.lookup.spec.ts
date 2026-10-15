import { WebClient } from '@slack/web-api';

import { findReactedMessage } from './reacted-message.lookup';

const clientReturning = (
  messages: { ts: string; text: string }[],
): { client: WebClient; replies: jest.Mock } => {
  const replies = jest.fn().mockResolvedValue({ ok: true, messages });
  return {
    client: { conversations: { replies } } as unknown as WebClient,
    replies,
  };
};

describe('findReactedMessage', () => {
  it('스레드 답글에 단 반응이면 원글이 아니라 그 답글을 돌려준다', async () => {
    // conversations.replies 는 답글 ts 로 불러도 원글을 앞에 붙여 돌려준다.
    const { client, replies } = clientReturning([
      { ts: '100.000', text: '원글' },
      { ts: '200.000', text: '압정 단 답글' },
    ]);

    const found = await findReactedMessage(client, 'C1', '200.000');

    expect(found?.text).toBe('압정 단 답글');
    expect(replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', ts: '200.000' }),
    );
  });

  it('ts 가 맞는 메시지가 없으면 엉뚱한 본문 대신 null 을 돌려준다', async () => {
    const { client } = clientReturning([{ ts: '100.000', text: '원글' }]);

    await expect(
      findReactedMessage(client, 'C1', '200.000'),
    ).resolves.toBeNull();
  });
});
