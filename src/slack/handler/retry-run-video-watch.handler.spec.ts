import { App } from '@slack/bolt';

import { RetryRunHandler } from './retry-run.handler';

type RetryCallback = (input: {
  ack: jest.Mock;
  command: { text: string; user_id: string };
  respond: jest.Mock;
}) => Promise<void>;

const setup = (inputSnapshot: Record<string, unknown>) => {
  const retryRunUsecase = {
    execute: jest.fn().mockResolvedValue({
      id: 42,
      agentType: 'VIDEO_WATCH',
      inputSnapshot,
    }),
  };
  const watchVideoUsecase = {
    execute: jest.fn().mockResolvedValue({
      agentRunId: 43,
      modelUsed: 'codex-cli',
      result: { answer: '재실행 답변', highlights: [] },
      report: {
        title: '영상 제목',
        videoId: 'jNQXAC9IVRw',
        frameCount: 3,
        transcriptSource: 'captions',
      },
    }),
  };
  const agentRunService = { setParentId: jest.fn() };
  const dependencies: object[] = Array.from({ length: 14 }, () => ({}));
  dependencies[0] = retryRunUsecase;
  dependencies[11] = agentRunService;
  dependencies[13] = watchVideoUsecase;
  const handler = Reflect.construct(
    RetryRunHandler,
    dependencies,
  ) as RetryRunHandler;
  const callbacks = new Map<string, RetryCallback>();
  handler.register({
    command: jest.fn((name: string, callback: RetryCallback) => {
      callbacks.set(name, callback);
    }),
  } as unknown as App);
  const respond = jest.fn();
  const run = () =>
    callbacks.get('/retry-run')?.({
      ack: jest.fn(),
      command: { text: '42', user_id: 'U1' },
      respond,
    });
  return { run, respond, watchVideoUsecase, agentRunService };
};

describe('RetryRunHandler VIDEO_WATCH', () => {
  it('저장된 영상 ID·질문으로 요청을 복원해 FAILURE_REPLAY 로 다시 돌리고 계보를 잇는다', async () => {
    const { run, respond, watchVideoUsecase, agentRunService } = setup({
      slackUserId: 'U1',
      videoId: 'jNQXAC9IVRw',
      question: '훅 설정 부분 설명해줘',
    });

    await run();

    expect(watchVideoUsecase.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      text: '훅 설정 부분 설명해줘 https://www.youtube.com/watch?v=jNQXAC9IVRw',
      triggerType: 'FAILURE_REPLAY',
    });
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('재실행 답변'),
      }),
    );
    expect(agentRunService.setParentId).toHaveBeenCalledWith({
      id: 43,
      parentId: 42,
    });
  });

  it('영상 ID 가 없는 기록은 실행하지 않고 다시 멘션하라고 안내한다', async () => {
    const { run, respond, watchVideoUsecase } = setup({ slackUserId: 'U1' });

    await run();

    expect(watchVideoUsecase.execute).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('다시 멘션해 주세요'),
      }),
    );
  });
});
