import { WatchVideoUsecase } from '../application/watch-video.usecase';
import { VideoWatchDispatcher } from './video-watch.dispatcher';

describe('VideoWatchDispatcher', () => {
  const execute = jest.fn();
  const dispatcher = new VideoWatchDispatcher({
    execute,
  } as unknown as WatchVideoUsecase);

  beforeEach(() => {
    execute.mockReset().mockResolvedValue({
      agentRunId: 3,
      modelUsed: 'codex',
      result: { answer: '답변', highlights: [] },
      report: {
        title: null,
        videoId: 'jNQXAC9IVRw',
        frameCount: 0,
        transcriptSource: null,
      },
    });
  });

  // 링크만 보낸 다음 턴 — 직전 턴의 질문이 사라지면 기본 요약으로 바뀐다.
  it('carries the prior-turn question when the user sends only a link', async () => {
    await dispatcher.dispatch({
      slackUserId: 'U1',
      source: 'SLACK_MESSAGE',
      text: 'https://youtu.be/jNQXAC9IVRw',
      conversationContext: { userInstruction: '훅 설정 부분 설명해줘' },
    });
    expect(execute.mock.calls[0][0].text).toContain('훅 설정 부분 설명해줘');
    expect(execute.mock.calls[0][0].text).toContain(
      'https://youtu.be/jNQXAC9IVRw',
    );
  });

  it('passes the text unchanged without conversation context', async () => {
    await dispatcher.dispatch({
      slackUserId: 'U1',
      source: 'SLACK_MESSAGE',
      text: '요약 https://youtu.be/jNQXAC9IVRw',
    });
    expect(execute.mock.calls[0][0].text).toBe(
      '요약 https://youtu.be/jNQXAC9IVRw',
    );
  });
});
