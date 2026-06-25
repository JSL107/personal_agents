import { AgentRunOutcome } from '../../../agent-run/application/agent-run.service';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { GenerateBlogDraftUsecase } from '../application/generate-blog-draft.usecase';
import { BlogDraftResult } from '../domain/blog.type';
import { BlogSlackNotifierPort } from '../domain/port/slack-notifier.port';
import { BlogDispatcher } from './blog.dispatcher';

// 백그라운드 Promise 가 microtask 큐를 비울 때까지 기다린다(void 로 띄운 runInBackground 완료 대기).
const flushPromises = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const buildNotifier = (): jest.Mocked<BlogSlackNotifierPort> => ({
  notify: jest.fn().mockResolvedValue(undefined),
});

const buildSuccessOutcome = (
  agentRunId = 42,
): AgentRunOutcome<BlogDraftResult> => ({
  agentRunId,
  modelUsed: 'hermes-cli',
  result: {
    notionUrl: 'https://app.notion.com/p/x',
    rawOutput: '초안 본문',
    published: true,
  },
});

// BlogDispatcher 는 자연어 멘션(input.text)을 GenerateBlogDraftUsecase 로 릴레이한다.
// - replyContext 없음(cron/슬래시/test): 기존 동기 — execute await 후 DispatchOutcome 매핑.
// - replyContext 있음(Slack 자연어): 즉시 "작성 시작" ack 반환 + 백그라운드 execute → notify.
describe('BlogDispatcher', () => {
  it('agentType 은 BLOG', () => {
    const dispatcher = new BlogDispatcher(
      {} as GenerateBlogDraftUsecase,
      buildNotifier(),
    );
    expect(dispatcher.agentType).toBe(AgentType.BLOG);
  });

  describe('동기 경로 (replyContext 없음)', () => {
    it('자연어 text 를 requestText 로 전달하고 outcome 을 DispatchOutcome 으로 매핑한다', async () => {
      const execute = jest.fn().mockResolvedValue(buildSuccessOutcome(42));
      const notifier = buildNotifier();
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        notifier,
      );

      const outcome = await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: 'CS 지식 블로그 써줘',
      });

      expect(execute).toHaveBeenCalledWith({
        requestText: 'CS 지식 블로그 써줘',
        slackUserId: 'U1',
      });
      expect(outcome.agentRunId).toBe(42);
      expect(outcome.modelUsed).toBe('hermes-cli');
      expect(outcome.output).toEqual({
        notionUrl: 'https://app.notion.com/p/x',
        rawOutput: '초안 본문',
        published: true,
      });
      expect(outcome.formattedText).toContain('블로그 발행 완료');
      expect(outcome.formattedText).toContain('app.notion.com');
      // 동기 경로는 notify 미사용(핸들러가 직접 say).
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('text 가 없으면 requestText 를 빈 문자열로 전달한다', async () => {
      const execute = jest.fn().mockResolvedValue(buildSuccessOutcome());
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        buildNotifier(),
      );

      await dispatcher.dispatch({ source: 'CRON', slackUserId: 'U2' });

      expect(execute).toHaveBeenCalledWith({
        requestText: '',
        slackUserId: 'U2',
      });
    });
  });

  describe('비동기 경로 (replyContext 있음)', () => {
    it('즉시 작성-시작 outcome(agentRunId=0) 반환 후 백그라운드로 notify', async () => {
      let resolveExec!: (v: AgentRunOutcome<BlogDraftResult>) => void;
      const execute = jest.fn().mockReturnValue(
        new Promise<AgentRunOutcome<BlogDraftResult>>((resolve) => {
          resolveExec = resolve;
        }),
      );
      const notifier = buildNotifier();
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        notifier,
      );

      const outcome = await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '루프 엔지니어링',
        replyContext: { channel: 'C1', threadTs: 'T1' },
      });

      expect(outcome.agentRunId).toBe(0);
      expect(outcome.formattedText).toContain('작성을 시작');
      // 아직 백그라운드 미완 → notify 호출 X.
      expect(notifier.notify).not.toHaveBeenCalled();

      resolveExec(buildSuccessOutcome(42));
      await flushPromises();

      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C1',
          threadTs: 'T1',
          text: expect.stringContaining('app.notion.com'),
        }),
      );
    });

    it('백그라운드 execute 실패 시 notify 를 실패 메시지로 호출', async () => {
      const execute = jest
        .fn()
        .mockRejectedValue(new Error('hermes 비정상 종료'));
      const notifier = buildNotifier();
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        notifier,
      );

      const outcome = await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '루프 엔지니어링',
        replyContext: { channel: 'C1', threadTs: 'T1' },
      });

      expect(outcome.agentRunId).toBe(0);
      await flushPromises();

      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C1',
          threadTs: 'T1',
          text: expect.stringContaining('hermes 비정상 종료'),
        }),
      );
    });
  });
});
