import { App } from '@slack/bolt';

import { PublishNotionDraftUsecase } from '../../agent/blog/application/publish-notion-draft.usecase';
import { BlogPublishHandler } from './blog-publish.handler';

type CommandCallback = (input: {
  ack: jest.Mock;
  command: {
    text: string;
    user_id: string;
    response_url: string;
  };
  respond: jest.Mock;
}) => Promise<void>;

describe('BlogPublishHandler', () => {
  it('/blog-publish는 즉시 ack 후 승인 버튼 카드와 전문을 응답한다', async () => {
    const execute = jest.fn().mockResolvedValue({
      agentRunId: 21,
      modelUsed: 'codex-cli',
      result: {
        status: 'preview',
        previewId: 'preview-1',
        previewText: '승인 카드',
        title: '제목',
        notionUrl: 'https://notion.so/page',
        path: 'src/content/posts/post.md',
        content: '마크다운 전문',
      },
    });
    const callbacks = new Map<string, CommandCallback>();
    const app = {
      command: jest.fn((name: string, callback: CommandCallback) => {
        callbacks.set(name, callback);
      }),
    } as unknown as App;
    const handler = new BlogPublishHandler({
      execute,
    } as unknown as PublishNotionDraftUsecase);
    handler.register(app);
    const ack = jest.fn().mockResolvedValue(undefined);
    const respond = jest.fn().mockResolvedValue(undefined);

    await callbacks.get('/blog-publish')?.({
      ack,
      command: {
        text: '제목',
        user_id: 'U1',
        response_url: 'https://hooks.slack.test/response',
      },
      respond,
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      titleQuery: '제목',
      responseUrl: 'https://hooks.slack.test/response',
    });
    expect(respond).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        replace_original: true,
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'actions' }),
        ]),
      }),
    );
    expect(respond).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        replace_original: false,
        text: expect.stringContaining('마크다운 전문'),
      }),
    );
  });
});
