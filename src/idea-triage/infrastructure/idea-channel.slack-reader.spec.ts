import { WebClient } from '@slack/web-api';

import { IdeaChannelSlackReader } from './idea-channel.slack-reader';

describe('IdeaChannelSlackReader', () => {
  it('토큰이 없으면 기록을 읽지 않는다', async () => {
    const reader = new IdeaChannelSlackReader(null);
    await expect(reader.listRecent('C1', new Date())).resolves.toBeNull();
    await expect(reader.getPermalink('C1', '1.1')).resolves.toBeNull();
  });

  it('최근 100개 상한과 Slack 필드를 보존한다', async () => {
    const history = jest.fn().mockResolvedValue({
      messages: [
        {
          ts: '2.2',
          text: '본문',
          user: 'U1',
          thread_ts: '1.1',
          subtype: 'bot_message',
          bot_id: 'B1',
        },
        { text: 'timestamp 없음' },
      ],
    });
    const client = {
      conversations: { history },
    } as unknown as WebClient;
    const reader = new IdeaChannelSlackReader(client);
    const result = await reader.listRecent(
      'C1',
      new Date('2026-10-07T00:00:00Z'),
    );
    expect(history).toHaveBeenCalledWith({
      channel: 'C1',
      oldest: '1791331200',
      limit: 100,
    });
    expect(result).toEqual([
      {
        ts: '2.2',
        text: '본문',
        user: 'U1',
        threadTs: '1.1',
        subtype: 'bot_message',
        botId: 'B1',
      },
    ]);
  });

  it('퍼머링크 실패는 null로 처리한다', async () => {
    const client = {
      chat: { getPermalink: jest.fn().mockRejectedValue(new Error('Slack')) },
    } as unknown as WebClient;
    await expect(
      new IdeaChannelSlackReader(client).getPermalink('C1', '1.1'),
    ).resolves.toBeNull();
  });
});
