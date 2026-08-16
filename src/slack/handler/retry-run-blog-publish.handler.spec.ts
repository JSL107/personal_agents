import { App } from '@slack/bolt';

import { RetryRunHandler } from './retry-run.handler';

type RetryCallback = (input: {
  ack: jest.Mock;
  command: { text: string; user_id: string };
  respond: jest.Mock;
}) => Promise<void>;

describe('RetryRunHandler BLOG_PUBLISH', () => {
  it('재실행 preview도 승인 버튼 카드와 발행 전문을 모두 응답한다', async () => {
    const retryRunUsecase = {
      execute: jest.fn().mockResolvedValue({
        id: 42,
        agentType: 'BLOG_PUBLISH',
        inputSnapshot: {
          slackUserId: 'U1',
          titleQuery: '회고',
          pageId: 'notion-page-1',
        },
      }),
    };
    const publishNotionDraftUsecase = {
      execute: jest.fn().mockResolvedValue({
        agentRunId: 43,
        modelUsed: 'codex-cli',
        result: {
          status: 'preview',
          previewId: 'preview-retry-1',
          previewText: '재실행 승인 카드',
          title: '회고',
          notionUrl: 'https://notion.so/page',
          path: 'src/content/posts/retry.md',
          content: '재실행 마크다운 전문',
        },
      }),
    };
    const agentRunService = { setParentId: jest.fn() };
    const dependencies: object[] = Array.from({ length: 19 }, () => ({}));
    dependencies[0] = retryRunUsecase;
    dependencies[15] = publishNotionDraftUsecase;
    dependencies[17] = agentRunService;
    const handler = Reflect.construct(
      RetryRunHandler,
      dependencies,
    ) as RetryRunHandler;
    const callbacks = new Map<string, RetryCallback>();
    const app = {
      command: jest.fn((name: string, callback: RetryCallback) => {
        callbacks.set(name, callback);
      }),
    } as unknown as App;
    handler.register(app);
    const ack = jest.fn();
    const respond = jest.fn();

    await callbacks.get('/retry-run')?.({
      ack,
      command: { text: '42', user_id: 'U1' },
      respond,
    });

    expect(publishNotionDraftUsecase.execute).toHaveBeenCalledWith({
      titleQuery: '회고',
      pageId: 'notion-page-1',
      slackUserId: 'U1',
      triggerType: 'FAILURE_REPLAY',
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
        text: expect.stringContaining('재실행 마크다운 전문'),
      }),
    );
    expect(agentRunService.setParentId).toHaveBeenCalledWith({
      id: 43,
      parentId: 42,
    });
  });
});
