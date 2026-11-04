import { SlackCollectorPort } from '../domain/port/slack-collector.port';
import { ListMyMentionsUsecase } from './list-my-mentions.usecase';

describe('ListMyMentionsUsecase', () => {
  it('collector 호출 결과를 그대로 반환', async () => {
    const fixture = [
      {
        channelId: 'C',
        channelName: 'g',
        channelType: 'public_channel' as const,
        authorUserId: 'U2',
        ts: '1.0',
        text: '<@U> 처리부탁',
        permalink: undefined,
      },
    ];
    const collector: jest.Mocked<SlackCollectorPort> = {
      listMyMentions: jest.fn().mockResolvedValue(fixture),
      getPermalink: jest.fn(),
    };
    const usecase = new ListMyMentionsUsecase(collector);

    const result = await usecase.execute({ slackUserId: 'U' });

    expect(result).toBe(fixture);
    expect(collector.listMyMentions).toHaveBeenCalledWith({
      slackUserId: 'U',
    });
  });
});
