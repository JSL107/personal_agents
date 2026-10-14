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
    it('userInstruction 을 원문 뒤 대화 맥락으로 결합한다', async () => {
      const execute = jest.fn().mockResolvedValue(buildSuccessOutcome());
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        buildNotifier(),
      );

      await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '프롬프트 RAG',
        conversationContext: {
          userInstruction: 'LLM 학습 목적으로 프롬프트와 RAG를 깊게 조사한다',
        },
      });

      expect(execute).toHaveBeenCalledWith({
        requestText:
          '프롬프트 RAG\n\n[대화 맥락] LLM 학습 목적으로 프롬프트와 RAG를 깊게 조사한다',
        slackUserId: 'U1',
      });
    });

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

    it('userInstruction 이 공백뿐이면 기존 requestText 를 그대로 전달한다', async () => {
      const execute = jest.fn().mockResolvedValue(buildSuccessOutcome());
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        buildNotifier(),
      );

      await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '프롬프트 RAG',
        conversationContext: { userInstruction: '   ' },
      });

      expect(execute).toHaveBeenCalledWith({
        requestText: '프롬프트 RAG',
        slackUserId: 'U1',
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
        conversationContext: {
          userInstruction: '직전 논의를 토대로 실패 패턴을 분석한다',
        },
        replyContext: { channel: 'C1', threadTs: 'T1' },
      });

      expect(outcome.agentRunId).toBe(0);
      expect(outcome.formattedText).toContain('작성을 시작');
      expect(execute).toHaveBeenCalledWith({
        requestText:
          '루프 엔지니어링\n\n[대화 맥락] 직전 논의를 토대로 실패 패턴을 분석한다',
        slackUserId: 'U1',
      });
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

    it('완료 답장을 대화 기억에도 남긴다 — 다음 턴 "이거 요약해줘" 가 원문을 보게', async () => {
      const execute = jest.fn().mockResolvedValue(buildSuccessOutcome(42));
      const rememberReply = jest.fn().mockResolvedValue(undefined);
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        buildNotifier(),
      );

      await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '프롬프트 RAG 공부해볼래',
        replyContext: { channel: 'C1', threadTs: 'T1', rememberReply },
      });
      await flushPromises();

      expect(rememberReply).toHaveBeenCalledWith(
        expect.stringContaining('app.notion.com'),
      );
    });

    it('대화 기억이 실패해도 답장은 나간다', async () => {
      const execute = jest.fn().mockResolvedValue(buildSuccessOutcome(42));
      const notifier = buildNotifier();
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        notifier,
      );

      await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '프롬프트 RAG 공부해볼래',
        replyContext: {
          channel: 'C1',
          rememberReply: jest.fn().mockRejectedValue(new Error('redis down')),
        },
      });
      await flushPromises();

      expect(notifier.notify).toHaveBeenCalledTimes(1);
    });

    // 2026-10-14 run 8837 — 요약 가능 여부를 물었는데 Notion 초안이 새로 생겼다.
    it('질문형 원문이면 초안을 만들지 않고 보류 안내를 돌려준다', async () => {
      const execute = jest.fn();
      const dispatcher = new BlogDispatcher(
        { execute } as unknown as GenerateBlogDraftUsecase,
        buildNotifier(),
      );

      const outcome = await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '<@U0AULUXLF9B> 지금 이거에 대해서 3줄 요약할 수 있어?',
        replyContext: { channel: 'C1', threadTs: 'T1' },
      });

      expect(execute).not.toHaveBeenCalled();
      expect(outcome.output).toEqual({
        heldWrite: { action: 'DRAFT', marker: expect.any(String) },
      });
      expect(outcome.formattedText).toContain(
        '블로그 초안을 작성하지 않았어요',
      );
    });
  });

  // 주제 번호 선택(갭 블로그)은 회신 컨텍스트 없이 동기로 온다 — 명시 선택이라 제목의 물음표로 막지 않는다.
  it('동기 경로는 물음표가 있어도 초안을 만든다', async () => {
    const execute = jest.fn().mockResolvedValue(buildSuccessOutcome());
    const dispatcher = new BlogDispatcher(
      { execute } as unknown as GenerateBlogDraftUsecase,
      buildNotifier(),
    );

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '왜 인덱스가 안 탈까?',
    });

    expect(execute).toHaveBeenCalled();
  });
});
