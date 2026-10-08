import { App } from '@slack/bolt';

import { HumanizeService } from '../../humanize/application/humanize.service';
import { ReplayFailedRunUsecase } from '../../run-replay/application/replay-failed-run.usecase';
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
  const dependencies: object[] = Array.from({ length: 13 }, () => ({}));
  dependencies[0] = retryRunUsecase;
  dependencies[11] = agentRunService;
  dependencies[12] = watchVideoUsecase;
  // 판정·디스패치는 replay 유스케이스로 옮겼다 — 그 생성자에 같은 목을 넣어 Slack 경로 전체를 그대로 검증한다.
  const replayFailedRunUsecase = Reflect.construct(
    ReplayFailedRunUsecase,
    dependencies,
  ) as ReplayFailedRunUsecase;
  const handler = new RetryRunHandler(
    replayFailedRunUsecase,
    {} as HumanizeService,
  );
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
  return { run, respond, watchVideoUsecase, agentRunService, retryRunUsecase };
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

  // 판정을 유스케이스로 옮긴 뒤에도 Slack 응답 모양은 그대로여야 한다 — 실행 기록을 못 찾은
  // 경우는 진행 문구를 덮지 않고, 실행별 거절은 덮는다.
  it('실행 기록이 없으면 진행 문구를 덮지 않고 안내한다', async () => {
    const { run, respond, retryRunUsecase } = setup({});
    retryRunUsecase.execute.mockResolvedValue(null);

    await run();

    expect(respond).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      text: 'run #42 를 찾을 수 없거나 FAILED 상태가 아닙니다.',
    });
  });

  it('다른 사용자의 실행은 진행 문구를 덮어 거절한다', async () => {
    const { run, respond, watchVideoUsecase } = setup({
      slackUserId: 'U_OTHER',
      videoId: 'jNQXAC9IVRw',
    });

    await run();

    expect(watchVideoUsecase.execute).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      replace_original: true,
      text: 'AgentRun #42 는 다른 사용자의 실행 기록이라 재실행할 수 없습니다.',
    });
  });
});
