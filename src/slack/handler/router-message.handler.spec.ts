import { App } from '@slack/bolt';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import { FindLatestPendingPreviewUsecase } from '../../preview-gate/application/find-latest-pending-preview.usecase';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import { ConversationalReplyUsecase } from '../../router/application/conversational-reply.usecase';
import { ConversationTurn } from '../../router/domain/conversation-memory.type';
import {
  DispatchInput,
  DispatchResult,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { RouterException } from '../../router/domain/router.exception';
import { RouterErrorCode } from '../../router/domain/router-error-code.enum';
import { RouterMessageHandler } from './router-message.handler';

// C-4 Phase 10 — fn → class 마이그레이션 이후 spec sync hotfix.
// `register*Handler(app, deps)` 호출 자리를 `new RouterMessageHandler(...).register(app)` 으로 치환.
// logger 는 class 가 자체 생성하므로 인자에서 제거 — runtime 노이즈는 spec 검증에 영향 없음.
const buildHandler = (
  idaeriRouter: IdaeriRouterPort,
  options: {
    conversationalReply?: ConversationalReplyUsecase;
    conversationMemory?: ConversationMemoryService;
    findLatestPendingPreview?: FindLatestPendingPreviewUsecase;
    applyPreviewUsecase?: ApplyPreviewUsecase;
    cancelPreviewUsecase?: CancelPreviewUsecase;
  } = {},
): RouterMessageHandler => {
  const conversationalReply =
    options.conversationalReply ??
    ({
      reply: jest.fn().mockResolvedValue('mock 자연어 응답'),
    } as unknown as ConversationalReplyUsecase);
  const conversationMemory =
    options.conversationMemory ?? new ConversationMemoryService();
  const findLatestPendingPreview =
    options.findLatestPendingPreview ??
    ({
      execute: jest.fn().mockResolvedValue(null),
    } as unknown as FindLatestPendingPreviewUsecase);
  const applyPreviewUsecase =
    options.applyPreviewUsecase ??
    ({
      execute: jest.fn().mockResolvedValue({ preview: null, resultText: '' }),
    } as unknown as ApplyPreviewUsecase);
  const cancelPreviewUsecase =
    options.cancelPreviewUsecase ??
    ({
      execute: jest.fn().mockResolvedValue(null),
    } as unknown as CancelPreviewUsecase);
  return new RouterMessageHandler(
    idaeriRouter,
    conversationMemory,
    conversationalReply,
    findLatestPendingPreview,
    applyPreviewUsecase,
    cancelPreviewUsecase,
  );
};

const buildPendingPreview = (
  overrides: Partial<PreviewAction> = {},
): PreviewAction => ({
  id: 'preview-id-1',
  slackUserId: 'U_USER',
  kind: PREVIEW_KIND.PM_WRITE_BACK,
  payload: {},
  status: PREVIEW_STATUS.PENDING,
  previewText: 'mock preview',
  responseUrl: null,
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  ...overrides,
});

const buildConversationTurn = (
  overrides: Partial<ConversationTurn>,
): ConversationTurn => ({
  role: 'assistant',
  text: 'fallback 응답',
  agentType: null,
  agentRunId: null,
  timestampMs: Date.now(),
  ...overrides,
});

type EventHandler = (args: {
  event: Record<string, unknown>;
  say: jest.Mock;
  client: { reactions: { add: jest.Mock; remove: jest.Mock } };
}) => Promise<void>;

interface AppMentionEvent {
  type?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
}

interface MessageEvent {
  type?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: 'im' | 'channel' | 'group' | 'mpim';
  subtype?: string;
  bot_id?: string;
}

const buildAppMock = (): {
  app: App;
  getHandler: (type: 'app_mention' | 'message') => EventHandler;
} => {
  const captured = new Map<string, EventHandler>();
  const app = {
    event: jest.fn((type: string, handler: EventHandler) => {
      captured.set(type, handler);
    }),
  } as unknown as App;
  return {
    app,
    getHandler: (type) => {
      const handler = captured.get(type);
      if (!handler) {
        throw new Error(`${type} handler 미등록`);
      }
      return handler;
    },
  };
};

const invokeHandler = async (
  handler: EventHandler,
  event: AppMentionEvent | MessageEvent,
): Promise<{
  say: jest.Mock;
  client: { reactions: { add: jest.Mock; remove: jest.Mock } };
}> => {
  const say = jest.fn();
  const client = {
    reactions: {
      add: jest.fn().mockResolvedValue({ ok: true }),
      remove: jest.fn().mockResolvedValue({ ok: true }),
    },
  };
  await handler({ event: event as Record<string, unknown>, say, client });
  return { say, client };
};

describe('RouterMessageHandler — app_mention', () => {
  it('app_mention + message 이벤트 둘 다 등록', () => {
    const { app } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = { dispatch: jest.fn() };

    buildHandler(idaeriRouter).register(app);

    expect(app.event).toHaveBeenCalledWith('app_mention', expect.any(Function));
    expect(app.event).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('멘션 prefix 제거 후 router.dispatch 호출 + formattedText + footer 응답', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatchResult: DispatchResult = {
      agentRunId: 99,
      workerType: AgentType.PM,
      output: { topPriority: [] },
      modelUsed: 'mock-model',
      formattedText: '*오늘의 최우선 과제*\nmock body',
    };
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockResolvedValue(dispatchResult),
    };
    buildHandler(idaeriRouter).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 오늘 plan 짜줘',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(idaeriRouter.dispatch).toHaveBeenCalledWith({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U_USER',
      text: '오늘 plan 짜줘',
      priorTurns: [],
      replyContext: {
        channel: 'C_CHANNEL',
        threadTs: '1730000000.000001',
      },
    } satisfies DispatchInput);
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1730000000.000001' }),
    );
    const sayText = say.mock.calls[0][0].text as string;
    expect(sayText).toContain('mock body');
    expect(sayText).toContain('agentRunId=99');
    expect(sayText).toContain(AgentType.PM);
  });

  it('handoffResults 가 있으면 chain 본문 결합 + worker 시퀀스 footer', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatchResult: DispatchResult = {
      agentRunId: 1,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'pm-mock',
      formattedText: 'PM body',
      handoffResults: [
        {
          agentRunId: 2,
          workerType: AgentType.BE,
          output: {},
          modelUsed: 'be-mock',
          formattedText: 'BE body',
        },
      ],
    };
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockResolvedValue(dispatchResult),
    };
    buildHandler(idaeriRouter).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> plan + impl',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    const sayText = say.mock.calls[0][0].text as string;
    expect(sayText).toContain('PM body');
    expect(sayText).toContain('BE body');
    expect(sayText).toContain('---');
    expect(sayText).toContain(`${AgentType.PM} → ${AgentType.BE}`);
    expect(sayText).toContain('agentRunIds=[1, 2]');
  });

  it('비동기 ack(agentRunId=0)면 footer 없이 안내 formattedText 만 say', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatchResult: DispatchResult = {
      agentRunId: 0,
      workerType: AgentType.BLOG,
      output: { async: true },
      modelUsed: 'hermes-cli',
      formattedText:
        '📝 블로그 초안 작성을 시작했어요. 몇 분 뒤 이 스레드에 Notion 링크를 올릴게요.',
    };
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockResolvedValue(dispatchResult),
    };
    buildHandler(idaeriRouter).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 루프 엔지니어링 블로그 써줘',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    const sayText = say.mock.calls[0][0].text as string;
    expect(sayText).toBe(dispatchResult.formattedText);
    expect(sayText).not.toContain('agentRunId');
    expect(sayText).not.toContain('이대리 (');
  });

  it('thread_ts 가 있으면 thread 답글 — 새 thread 생성 안 함', async () => {
    const { app, getHandler } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockResolvedValue({
        agentRunId: 1,
        workerType: AgentType.PM,
        output: {},
        modelUsed: 'mock',
        formattedText: 'mock body',
      }),
    };
    buildHandler(idaeriRouter).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 안녕',
      ts: '1730000000.000200',
      thread_ts: '1730000000.000100',
      channel: 'C_CHANNEL',
    });

    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1730000000.000100' }),
    );
  });

  it('text 가 멘션 prefix 만이면 비어 있다고 안내 + router.dispatch 미호출', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn();
    const idaeriRouter: IdaeriRouterPort = { dispatch };
    buildHandler(idaeriRouter).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT>',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('비어'),
      }),
    );
  });

  it('router 가 INTENT_CLASSIFY_FAILED throw → ConversationalReply fallback 으로 자연어 응답', async () => {
    const { app, getHandler } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: '의도 분류 실패 — UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      ),
    };
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('안녕하세요! 무엇을 도와드릴까요?'),
    } as unknown as ConversationalReplyUsecase;
    buildHandler(idaeriRouter, { conversationalReply }).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 지금 뭐해?',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(conversationalReply.reply).toHaveBeenCalledWith(
      expect.objectContaining({ text: '지금 뭐해?' }),
    );
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '안녕하세요! 무엇을 도와드릴까요?',
      }),
    );
  });

  it('질문으로 끝난 assistant/null turn 이 2회 연속이면 unresolvedStreak=2를 전달한다', async () => {
    const { app, getHandler } = buildAppMock();
    const conversationMemory = new ConversationMemoryService();
    const memoryKey = conversationMemory.buildKey({
      slackUserId: 'U_USER',
      channelId: 'C_CHANNEL',
      threadTs: '1730000000.000001',
    });
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ role: 'user', text: '첫 질문' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '어떤 PR인가요?' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ role: 'user', text: '둘째 질문' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '링크를 알려주시겠어요？   ' }),
    );
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: 'UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      ),
    };
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('방향을 바꿔볼게요.'),
    } as unknown as ConversationalReplyUsecase;
    buildHandler(idaeriRouter, {
      conversationMemory,
      conversationalReply,
    }).register(app);

    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 그럼 어떻게 해?',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(conversationalReply.reply).toHaveBeenCalledWith(
      expect.objectContaining({ unresolvedStreak: 2 }),
    );
  });

  it('질문이 아닌 assistant/null turn 이 2회 연속이어도 unresolvedStreak=0을 전달한다', async () => {
    const { app, getHandler } = buildAppMock();
    const conversationMemory = new ConversationMemoryService();
    const memoryKey = conversationMemory.buildKey({
      slackUserId: 'U_USER',
      channelId: 'C_CHANNEL',
      threadTs: '1730000000.000001',
    });
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ role: 'user', text: '안녕' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '안녕하세요!' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ role: 'user', text: '고마워' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '도움이 되어 기뻐요.' }),
    );
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: 'UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      ),
    };
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('어떤 PR을 볼까요?'),
    } as unknown as ConversationalReplyUsecase;
    buildHandler(idaeriRouter, {
      conversationMemory,
      conversationalReply,
    }).register(app);

    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> PR 좀 봐줘',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(conversationalReply.reply).toHaveBeenCalledWith(
      expect.objectContaining({ unresolvedStreak: 0 }),
    );
  });

  it('되묻기 뒤 정상 종결 응답이 끼면 이전 streak를 이어 세지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const conversationMemory = new ConversationMemoryService();
    const memoryKey = conversationMemory.buildKey({
      slackUserId: 'U_USER',
      channelId: 'C_CHANNEL',
      threadTs: '1730000000.000001',
    });
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '어떤 작업이 필요한가요?' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ role: 'user', text: '고마워' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '도움이 되어 기뻐요.' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ role: 'user', text: 'PR 리뷰' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '어떤 PR인가요?' }),
    );
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: 'UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      ),
    };
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('링크를 알려주시겠어요?'),
    } as unknown as ConversationalReplyUsecase;
    buildHandler(idaeriRouter, {
      conversationMemory,
      conversationalReply,
    }).register(app);

    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 다시 봐줘',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(conversationalReply.reply).toHaveBeenCalledWith(
      expect.objectContaining({ unresolvedStreak: 1 }),
    );
  });

  it('중간 worker assistant turn 이 있으면 그 뒤의 연속 fallback만 센다', async () => {
    const { app, getHandler } = buildAppMock();
    const conversationMemory = new ConversationMemoryService();
    const memoryKey = conversationMemory.buildKey({
      slackUserId: 'U_USER',
      channelId: 'C_CHANNEL',
      threadTs: '1730000000.000001',
    });
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '어떤 요청인가요?' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({
        role: 'user',
        text: 'worker 요청',
        agentType: AgentType.PM,
        agentRunId: 41,
      }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ agentType: AgentType.PM, agentRunId: 41 }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ role: 'user', text: 'fallback 질문' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '무엇을 확인할까요?' }),
    );
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: 'UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      ),
    };
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('한 번 더 확인할게요.'),
    } as unknown as ConversationalReplyUsecase;
    buildHandler(idaeriRouter, {
      conversationMemory,
      conversationalReply,
    }).register(app);

    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 다음은?',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(conversationalReply.reply).toHaveBeenCalledWith(
      expect.objectContaining({ unresolvedStreak: 1 }),
    );
  });

  it('preview·실패 형태의 user/null turn 은 fallback streak로 세지 않는다', async () => {
    const { app, getHandler } = buildAppMock();
    const conversationMemory = new ConversationMemoryService();
    const memoryKey = conversationMemory.buildKey({
      slackUserId: 'U_USER',
      channelId: 'C_CHANNEL',
      threadTs: '1730000000.000001',
    });
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({ text: '어떤 작업인가요?' }),
    );
    await conversationMemory.appendTurn(
      memoryKey,
      buildConversationTurn({
        role: 'user',
        text: 'preview 선택',
        agentType: null,
      }),
    );
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: 'UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      ),
    };
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('원하는 걸 알려주세요.'),
    } as unknown as ConversationalReplyUsecase;
    buildHandler(idaeriRouter, {
      conversationMemory,
      conversationalReply,
    }).register(app);

    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 다시',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(conversationalReply.reply).toHaveBeenCalledWith(
      expect.objectContaining({ unresolvedStreak: 1 }),
    );
  });

  it('성공 응답 시 ✅ reaction 부착 (white_check_mark)', async () => {
    const { app, getHandler } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockResolvedValue({
        agentRunId: 1,
        workerType: AgentType.PM,
        output: {},
        modelUsed: 'mock',
        formattedText: 'mock body',
      }),
    };
    buildHandler(idaeriRouter).register(app);

    const { client } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 오늘 plan',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(client.reactions.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'white_check_mark' }),
    );
    expect(client.reactions.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'eyes' }),
    );
    expect(client.reactions.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'hourglass' }),
    );
    expect(client.reactions.remove).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'hourglass' }),
    );
  });

  it('Conversational fallback 성공도 ✅ reaction 부착', async () => {
    const { app, getHandler } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: 'UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      ),
    };
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('네 안녕하세요'),
    } as unknown as ConversationalReplyUsecase;
    buildHandler(idaeriRouter, { conversationalReply }).register(app);

    const { client } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 안녕',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(client.reactions.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'white_check_mark' }),
    );
  });

  it('router 가 일반 Error throw 하면 generic 메시지로 차단 (stack leak 방어)', async () => {
    const { app, getHandler } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockRejectedValue(new Error('내부 stack')),
    };
    buildHandler(idaeriRouter).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 어쩌고',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('내부 오류'),
      }),
    );
  });
});

describe('RouterMessageHandler — message (DM)', () => {
  const buildWithRouter = (dispatch: jest.Mock = jest.fn()) => {
    const { app, getHandler } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = { dispatch };
    buildHandler(idaeriRouter).register(app);
    return { handler: getHandler('message'), dispatch };
  };

  it('channel_type=im + 일반 user message → router.dispatch (멘션 prefix 없이 전체 text)', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 5,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'DM body',
    });
    const { handler } = buildWithRouter(dispatch);

    const { say } = await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '오늘 plan 짜줘',
      ts: '1730000000.000001',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });

    expect(dispatch).toHaveBeenCalledWith({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U_USER',
      text: '오늘 plan 짜줘',
      priorTurns: [],
      replyContext: {
        channel: 'D_DMCHANNEL',
        threadTs: '1730000000.000001',
      },
    } satisfies DispatchInput);
    expect(say).toHaveBeenCalled();
  });

  // 회귀: DM top-level 메시지에 봇이 답글로 스레드를 만들면, 사용자의 후속 메시지에는
  // thread_ts(=첫 메시지 ts)가 붙는다. 메모리 키를 실제 thread_ts 만으로 잡던 동안에는
  // 첫 턴이 channel 키, 후속 턴이 thread 키로 갈려 2턴째 priorTurns 가 0 이 됐다
  // (2026-08-13 실제 로그: "가상 계좌 조회해서 알려줘" priorTurns=0).
  it('DM 첫 턴 뒤 봇이 만든 스레드에서 이어 말하면 직전 대화가 priorTurns 로 전달된다', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 5,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'DM body',
    });
    const { handler } = buildWithRouter(dispatch);

    // 1턴: top-level DM (thread_ts 없음) — 봇은 ts 로 스레드를 만들어 답글.
    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '가상 계좌 수익률 어때',
      ts: '1730000000.000001',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });
    // 2턴: 봇이 만든 그 스레드 안에서 후속 발화 (thread_ts = 1턴의 ts).
    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '로컬에 있는 가상계좌',
      ts: '1730000000.000002',
      thread_ts: '1730000000.000001',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
    const secondCall = dispatch.mock.calls[1][0] as DispatchInput;
    expect(secondCall.priorTurns).toHaveLength(2);
    expect(secondCall.priorTurns?.[0]).toEqual(
      expect.objectContaining({ role: 'user', text: '가상 계좌 수익률 어때' }),
    );
    // 직전 worker run 도 이어져야 한다 (같은 대화의 후속 실행 컨텍스트).
    expect(secondCall.contextRefs).toEqual({ agentRunId: 5 });
  });

  // 회귀: 스레드가 아니라 DM 입력창에서 연달아 말하는 흐름. 두 이벤트 모두 thread_ts 가
  // 없고 ts 만 다르므로, 메모리 키에 messageTs 를 섞으면 매 발화가 새 키가 되어 끊긴다.
  it('DM 입력창에서 연달아 말하면(스레드 아님) 맥락이 이어진다', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 7,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'DM body',
    });
    const { handler } = buildWithRouter(dispatch);

    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '가상 계좌 수익률 어때',
      ts: '1730000000.000001',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });
    // 스레드에 들어가지 않고 입력창에서 다시 — thread_ts 없음, ts 만 다르다.
    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '로컬에 있는 가상계좌',
      ts: '1730000000.000002',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });

    const secondCall = dispatch.mock.calls[1][0] as DispatchInput;
    expect(secondCall.priorTurns).toHaveLength(2);
    expect(secondCall.priorTurns?.[0]).toEqual(
      expect.objectContaining({ role: 'user', text: '가상 계좌 수익률 어때' }),
    );
  });

  // 되짚기는 스레드 첫 진입에서만 일어나야 한다 — 스레드에 이미 턴이 쌓였으면
  // channel 키의 다른 대화가 섞여 들어오면 안 된다.
  it('스레드에 턴이 쌓인 뒤에는 channel 키를 되짚지 않는다', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 9,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'DM body',
    });
    const { handler } = buildWithRouter(dispatch);

    // channel 키에 별개 대화 1건 (스레드 밖 top-level).
    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '채널 키 쪽 대화',
      ts: '1730000000.000001',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });
    // 다른 스레드에서 2턴 진행 (첫 턴은 되짚기로 channel 을 보지만, 이후는 스레드 키).
    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '스레드 첫 발화',
      ts: '1730000000.000010',
      thread_ts: '1730000000.000009',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });
    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '스레드 두 번째 발화',
      ts: '1730000000.000011',
      thread_ts: '1730000000.000009',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });

    const thirdCall = dispatch.mock.calls[2][0] as DispatchInput;
    const texts = (thirdCall.priorTurns ?? []).map((turn) => turn.text);
    expect(texts).toContain('스레드 첫 발화');
    expect(texts).not.toContain('채널 키 쪽 대화');
  });

  it('channel_type=channel (DM 아닌 일반 채널) → skip — dispatch 미호출', async () => {
    const { handler, dispatch } = buildWithRouter();

    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '안녕',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
      channel_type: 'channel',
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('subtype 있는 message (edit / delete 등) → skip', async () => {
    const { handler, dispatch } = buildWithRouter();

    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '수정된 메시지',
      ts: '1730000000.000001',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
      subtype: 'message_changed',
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('bot_id 있는 메시지 (봇 자신 발화) → skip — 무한 루프 방지', async () => {
    const { handler, dispatch } = buildWithRouter();

    await invokeHandler(handler, {
      type: 'message',
      user: 'U_USER',
      text: '봇이 보낸 메시지',
      ts: '1730000000.000001',
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
      bot_id: 'B_BOTID',
    });

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('RouterMessageHandler — 자연어 Y/N preview 인터셉트', () => {
  const baseEvent = {
    type: 'app_mention' as const,
    user: 'U_USER',
    ts: '1730000000.000001',
    channel: 'C_CHANNEL',
  };

  it('pending preview 있음 + "응" → ApplyPreviewUsecase 호출 (dispatch 미호출)', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn();
    const idaeriRouter: IdaeriRouterPort = { dispatch };
    const pending = buildPendingPreview();
    const findLatestPendingPreview = {
      execute: jest.fn().mockResolvedValue(pending),
    } as unknown as FindLatestPendingPreviewUsecase;
    const applyPreviewUsecase = {
      execute: jest.fn().mockResolvedValue({
        preview: pending,
        resultText: '✅ Notion 페이지에 적재 완료',
      }),
    } as unknown as ApplyPreviewUsecase;
    const cancelPreviewUsecase = {
      execute: jest.fn(),
    } as unknown as CancelPreviewUsecase;

    buildHandler(idaeriRouter, {
      findLatestPendingPreview,
      applyPreviewUsecase,
      cancelPreviewUsecase,
    }).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      ...baseEvent,
      text: '<@UBOT> 응',
    });

    expect(applyPreviewUsecase.execute).toHaveBeenCalledWith({
      previewId: pending.id,
      slackUserId: 'U_USER',
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('적용 완료'),
      }),
    );
  });

  it('pending preview 있음 + "아니" → CancelPreviewUsecase 호출', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn();
    const pending = buildPendingPreview();
    const cancelPreviewUsecase = {
      execute: jest.fn().mockResolvedValue(pending),
    } as unknown as CancelPreviewUsecase;
    const applyPreviewUsecase = {
      execute: jest.fn(),
    } as unknown as ApplyPreviewUsecase;

    buildHandler(
      { dispatch },
      {
        findLatestPendingPreview: {
          execute: jest.fn().mockResolvedValue(pending),
        } as unknown as FindLatestPendingPreviewUsecase,
        applyPreviewUsecase,
        cancelPreviewUsecase,
      },
    ).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      ...baseEvent,
      text: '<@UBOT> 아니',
    });

    expect(cancelPreviewUsecase.execute).toHaveBeenCalledWith({
      previewId: pending.id,
      slackUserId: 'U_USER',
    });
    expect(applyPreviewUsecase.execute).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('취소'),
      }),
    );
  });

  it('pending preview 없음 → 정상 dispatch 흐름으로 fall through', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 1,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'mock body',
    });
    const applyPreviewUsecase = {
      execute: jest.fn(),
    } as unknown as ApplyPreviewUsecase;

    buildHandler(
      { dispatch },
      {
        findLatestPendingPreview: {
          execute: jest.fn().mockResolvedValue(null),
        } as unknown as FindLatestPendingPreviewUsecase,
        applyPreviewUsecase,
      },
    ).register(app);

    await invokeHandler(getHandler('app_mention'), {
      ...baseEvent,
      text: '<@UBOT> 응',
    });

    expect(dispatch).toHaveBeenCalled();
    expect(applyPreviewUsecase.execute).not.toHaveBeenCalled();
  });

  it('pending preview 있음 + ambiguous 입력 ("오늘 plan 짜줘") → dispatch 로 fall through', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 1,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'mock body',
    });
    const applyPreviewUsecase = {
      execute: jest.fn(),
    } as unknown as ApplyPreviewUsecase;
    const cancelPreviewUsecase = {
      execute: jest.fn(),
    } as unknown as CancelPreviewUsecase;

    buildHandler(
      { dispatch },
      {
        findLatestPendingPreview: {
          execute: jest.fn().mockResolvedValue(buildPendingPreview()),
        } as unknown as FindLatestPendingPreviewUsecase,
        applyPreviewUsecase,
        cancelPreviewUsecase,
      },
    ).register(app);

    await invokeHandler(getHandler('app_mention'), {
      ...baseEvent,
      text: '<@UBOT> 오늘 plan 짜줘',
    });

    expect(dispatch).toHaveBeenCalled();
    expect(applyPreviewUsecase.execute).not.toHaveBeenCalled();
    expect(cancelPreviewUsecase.execute).not.toHaveBeenCalled();
  });
});

describe('RouterMessageHandler — 갭 분석 주제선택 인터셉트', () => {
  const baseEvent = {
    type: 'app_mention' as const,
    user: 'U_USER',
    ts: '1730000000.000001',
    channel: 'C_CHANNEL',
  };

  it('pending CAREER_JD_GAP_BLOG + "2번" → preview consume + BLOG 체인(agentTypeHint)', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 50,
      workerType: AgentType.BLOG,
      output: {},
      modelUsed: 'hermes',
      formattedText: '✅ notion-url',
    });
    const pending = buildPendingPreview({
      id: 'pv1',
      kind: PREVIEW_KIND.CAREER_JD_GAP_BLOG,
      payload: {
        topics: [
          { title: 'A', rationale: 'r' },
          { title: 'B글', rationale: 'r' },
        ],
      },
    });
    const findLatestPendingPreview = {
      execute: jest.fn().mockResolvedValue(pending),
    } as unknown as FindLatestPendingPreviewUsecase;
    const cancelPreviewUsecase = {
      execute: jest.fn().mockResolvedValue(pending),
    } as unknown as CancelPreviewUsecase;

    buildHandler(
      { dispatch },
      { findLatestPendingPreview, cancelPreviewUsecase },
    ).register(app);

    await invokeHandler(getHandler('app_mention'), {
      ...baseEvent,
      text: '<@UBOT> 2번',
    });

    expect(cancelPreviewUsecase.execute).toHaveBeenCalledWith({
      previewId: 'pv1',
      slackUserId: 'U_USER',
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ agentTypeHint: AgentType.BLOG, text: 'B글' }),
    );
  });

  it('pending CAREER_JD_GAP_BLOG + 범위 밖("9번") → 일반 dispatch 로 fall through', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 1,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'mock body',
    });
    const cancelPreviewUsecase = {
      execute: jest.fn(),
    } as unknown as CancelPreviewUsecase;

    buildHandler(
      { dispatch },
      {
        findLatestPendingPreview: {
          execute: jest.fn().mockResolvedValue(
            buildPendingPreview({
              kind: PREVIEW_KIND.CAREER_JD_GAP_BLOG,
              payload: { topics: [{ title: 'A', rationale: 'r' }] },
            }),
          ),
        } as unknown as FindLatestPendingPreviewUsecase,
        cancelPreviewUsecase,
      },
    ).register(app);

    await invokeHandler(getHandler('app_mention'), {
      ...baseEvent,
      text: '<@UBOT> 9번',
    });

    expect(cancelPreviewUsecase.execute).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ text: '9번' }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ agentTypeHint: AgentType.BLOG }),
    );
  });
});
