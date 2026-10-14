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
import { MentionReceiptRepositoryPort } from '../domain/port/mention-receipt.repository.port';
import { SlackDeliveryRepositoryPort } from '../domain/port/slack-delivery.repository.port';
import {
  pickThreadReplies,
  RouterMessageHandler,
} from './router-message.handler';

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
    deliveryRepository?: SlackDeliveryRepositoryPort;
    mentionReceiptRepository?: MentionReceiptRepositoryPort;
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
  const deliveryRepository =
    options.deliveryRepository ??
    ({
      incrementReplyCount: jest.fn().mockResolvedValue(0),
    } as unknown as SlackDeliveryRepositoryPort);
  return new RouterMessageHandler(
    idaeriRouter,
    conversationMemory,
    conversationalReply,
    findLatestPendingPreview,
    applyPreviewUsecase,
    cancelPreviewUsecase,
    deliveryRepository,
    options.mentionReceiptRepository ?? {
      recordReceived: jest.fn().mockResolvedValue(undefined),
      recordOutcome: jest.fn().mockResolvedValue(undefined),
      recordFinalReply: jest.fn().mockResolvedValue(undefined),
    },
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
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
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
        conversationKey: 'U_USER:C_CHANNEL:1730000000.000001',
        replyThreadKey: 'U_USER:C_CHANNEL:1730000000.000001',
        rememberReply: expect.any(Function),
        markFinalReplyPending: expect.any(Function),
        recordFinalReply: expect.any(Function),
      },
    } satisfies DispatchInput);
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1730000000.000001' }),
    );
    const sayText = say.mock.calls[0][0].text as string;
    expect(sayText).toContain('mock body');
    expect(sayText).toContain('_이대리 (오늘 계획) · 실행 #99_');
  });

  // 2026-10-14 run 8837 — 비동기 블로그 완료 답장이 기억에 없어 다음 턴 "이거 요약해줘" 가 원문을 못 봤다.
  it('rememberReply 는 완료 답장을 같은 대화 기억 키에 봇 턴으로 남긴다', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 0,
      workerType: AgentType.BLOG,
      output: { async: true },
      modelUsed: 'hermes-cli',
      formattedText: '📝 블로그 초안 작성을 시작했어요.',
    } satisfies DispatchResult);
    const conversationMemory = new ConversationMemoryService();
    buildHandler({ dispatch }, { conversationMemory }).register(app);

    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 프롬프트 RAG 공부해볼래',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });
    const input = dispatch.mock.calls[0][0] as DispatchInput;
    await input.replyContext?.rememberReply?.(
      '🚀 *블로그 발행 완료*\n요약 본문',
    );

    const turns = await conversationMemory.getRecentTurns(
      conversationMemory.buildKey({
        slackUserId: 'U_USER',
        channelId: 'C_CHANNEL',
        threadTs: '1730000000.000001',
      }),
    );
    expect(turns.at(-1)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        text: '🚀 *블로그 발행 완료*\n요약 본문',
        agentType: AgentType.BLOG,
      }),
    );
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
          workerType: AgentType.CODE_REVIEWER,
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
    expect(sayText).toContain('오늘 계획 → 코드 리뷰 · 실행 #1, #2');
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

  it('스레드 첫 멘션이면 부모 메시지(봇 알림)를 직전 턴으로 넘긴다', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockRejectedValue(
      new RouterException({
        code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
        message: 'unknown',
        status: DomainStatus.BAD_REQUEST,
      }),
    );
    const reply = jest.fn().mockResolvedValue('429 는 요청 과다 응답입니다');
    const conversationMemory = new ConversationMemoryService();
    buildHandler(
      { dispatch },
      {
        conversationMemory,
        conversationalReply: { reply } as unknown as ConversationalReplyUsecase,
      },
    ).register(app);
    const replies = jest.fn().mockResolvedValue({
      messages: [
        {
          ts: '1730000000.000100',
          bot_id: 'B_IDAERI',
          text: '⚠️ 포트폴리오 사이트 응답 없음 — 사유: HTTP 429',
        },
      ],
    });
    const client = {
      reactions: {
        add: jest.fn().mockResolvedValue({ ok: true }),
        remove: jest.fn().mockResolvedValue({ ok: true }),
      },
      conversations: { replies },
    };
    const handler = getHandler('app_mention') as unknown as (args: {
      event: Record<string, unknown>;
      say: jest.Mock;
      client: unknown;
    }) => Promise<void>;
    const event = {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 이거 왜 오류인지 확인해줄래?',
      ts: '1730000000.000200',
      thread_ts: '1730000000.000100',
      channel: 'C_CHANNEL',
    };

    await handler({ event, say: jest.fn(), client });
    // 두 번째 턴은 스레드 메모리에 쌓인 부모를 그대로 쓰므로 다시 조회하지 않는다.
    await handler({
      event: { ...event, ts: '1730000000.000300', text: '<@UBOT> 더 알려줘' },
      say: jest.fn(),
      client,
    });

    expect(replies).toHaveBeenCalledTimes(1);
    expect(replies).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C_CHANNEL',
        ts: '1730000000.000100',
      }),
    );
    const firstTurns = reply.mock.calls[0][0].priorTurns as ConversationTurn[];
    expect(firstTurns).toEqual([
      // 봇이 쓴 부모라도 assistant(=이대리 자신의 발화)로 올리지 않고 원문 표식을 단 user 턴으로 싣는다.
      expect.objectContaining({
        role: 'user',
        text: expect.stringMatching(
          /^\[스레드 원문[^\n]*\]\n⚠️ 포트폴리오 사이트 응답 없음 — 사유: HTTP 429$/,
        ),
      }),
    ]);
    const secondTurns = reply.mock.calls[1][0].priorTurns as ConversationTurn[];
    expect(secondTurns[0]).toEqual(
      expect.objectContaining({ text: expect.stringContaining('HTTP 429') }),
    );
  });

  it('스레드 부모 조회가 실패해도 부모 없이 답한다', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 1,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'mock body',
    });
    buildHandler({ dispatch }).register(app);

    // invokeHandler 의 client 에는 conversations 가 없어 조회가 throw 한다.
    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 이거 뭐야',
      ts: '1730000000.000200',
      thread_ts: '1730000000.000100',
      channel: 'C_CHANNEL',
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ priorTurns: [] }),
    );
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('mock body') }),
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

  // #817 리뷰 — DM 최상위 발화는 channel 키에 쌓이지만 완료 답장은 그 발화의 스레드에 달린다.
  describe('비동기 완료 답장 기억 (rememberReply)', () => {
    const DM_TS = '1730000000.000001';
    const setup = async () => {
      const dispatch = jest.fn().mockResolvedValue({
        agentRunId: 0,
        workerType: AgentType.BLOG,
        output: { async: true },
        modelUsed: 'hermes-cli',
        formattedText: '📝 블로그 초안 작성을 시작했어요.',
      } satisfies DispatchResult);
      const conversationMemory = new ConversationMemoryService();
      const { app, getHandler } = buildAppMock();
      buildHandler({ dispatch }, { conversationMemory }).register(app);
      await invokeHandler(getHandler('message'), {
        type: 'message',
        user: 'U_USER',
        text: '프롬프트 RAG 공부해볼래',
        ts: DM_TS,
        channel: 'D_DMCHANNEL',
        channel_type: 'im',
      });
      const input = dispatch.mock.calls[0][0] as DispatchInput;
      const channelKey = conversationMemory.buildKey({
        slackUserId: 'U_USER',
        channelId: 'D_DMCHANNEL',
      });
      const threadKey = conversationMemory.buildKey({
        slackUserId: 'U_USER',
        channelId: 'D_DMCHANNEL',
        threadTs: DM_TS,
      });
      return { input, conversationMemory, channelKey, threadKey };
    };
    const COMPLETION = '🚀 *블로그 발행 완료*\n요약 본문';

    it('작업 중 스레드로 대화가 옮겨 갔으면 스레드 키에도 남긴다', async () => {
      const { input, conversationMemory, channelKey, threadKey } =
        await setup();
      await conversationMemory.appendTurn(threadKey, {
        role: 'user',
        text: '나랑 브레인 스토밍도 가능해?',
        agentType: null,
        agentRunId: null,
        timestampMs: Date.now(),
      });

      await input.replyContext?.rememberReply?.(COMPLETION, 42);

      const threadTurns = await conversationMemory.getRecentTurns(threadKey);
      const channelTurns = await conversationMemory.getRecentTurns(channelKey);
      expect(threadTurns.at(-1)?.text).toBe(COMPLETION);
      expect(channelTurns.at(-1)?.text).toBe(COMPLETION);
      // 실행 id 가 실려 다음 "작업 끝났어?" 가 이 실행의 상태를 바로 조회한다.
      expect(threadTurns.at(-1)?.agentRunId).toBe(42);
      // channel 키 쪽에는 게시된 스레드가 적혀, 다른 스레드로 옮겨 담기지 않는다.
      expect(channelTurns.at(-1)?.replyThreadKey).toBe(threadKey);
    });

    it('스레드 키가 비어 있으면 channel 키에만 남긴다 — 첫 스레드 진입의 channel 키 되짚기를 막지 않게', async () => {
      const { input, conversationMemory, channelKey, threadKey } =
        await setup();

      await input.replyContext?.rememberReply?.(COMPLETION);

      expect(await conversationMemory.getRecentTurns(threadKey)).toEqual([]);
      expect(
        (await conversationMemory.getRecentTurns(channelKey)).at(-1)?.text,
      ).toBe(COMPLETION);
    });
  });

  // #824·#838 리뷰 — "작업하고 있어?" 는 그 작업을 맡긴 스레드의 실행을 봐야 한다. DM 최상위 블로그
  // 실행은 모두 같은 channel 키에서 시작하므로 channel 키로 찾으면 나중에 맡긴 다른 블로그가 잡힌다.
  // 실행에는 답장 스레드 키가 남으니 지금 스레드 키로 찾는다.
  it('DM 최상위에서 블로그를 두 번 맡겨도 앞 스레드에서 물으면 그 스레드 키로 찾는다', async () => {
    const A_TS = '1730000000.000001';
    const B_TS = '1730000000.000002';
    const ack = {
      agentRunId: 0,
      workerType: AgentType.BLOG,
      output: { async: true },
      modelUsed: 'hermes-cli',
      formattedText: '📝 블로그 초안 작성을 시작했어요.',
    } satisfies DispatchResult;
    const dispatch = jest
      .fn()
      .mockResolvedValueOnce(ack)
      .mockResolvedValueOnce(ack)
      .mockRejectedValueOnce(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: '의도 분류 실패 — UNKNOWN',
          status: DomainStatus.BAD_REQUEST,
        }),
      );
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('아직 쓰고 있어요.'),
    } as unknown as ConversationalReplyUsecase;
    const { app, getHandler } = buildAppMock();
    buildHandler(
      { dispatch },
      {
        conversationalReply,
        conversationMemory: new ConversationMemoryService(),
      },
    ).register(app);

    for (const [ts, text] of [
      [A_TS, '프롬프트 RAG 블로그 써줘'],
      [B_TS, '루프 엔지니어링 블로그 써줘'],
    ]) {
      await invokeHandler(getHandler('message'), {
        type: 'message',
        user: 'U_USER',
        text,
        ts,
        channel: 'D_DMCHANNEL',
        channel_type: 'im',
      });
    }
    await invokeHandler(getHandler('message'), {
      type: 'message',
      user: 'U_USER',
      text: '너 작업하고 있어?',
      ts: '1730000000.000003',
      thread_ts: A_TS,
      channel: 'D_DMCHANNEL',
      channel_type: 'im',
    });

    const startedA = dispatch.mock.calls[0][0] as DispatchInput;
    const startedB = dispatch.mock.calls[1][0] as DispatchInput;
    // 두 실행은 시작 키를 공유하고 답장 스레드 키로만 갈린다.
    expect(startedA.replyContext?.conversationKey).toBe('U_USER:D_DMCHANNEL');
    expect(startedB.replyContext?.conversationKey).toBe('U_USER:D_DMCHANNEL');
    expect(startedB.replyContext?.replyThreadKey).toBe(
      `U_USER:D_DMCHANNEL:${B_TS}`,
    );
    expect(conversationalReply.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: startedA.replyContext?.replyThreadKey,
      }),
    );
    expect(startedA.replyContext?.replyThreadKey).toBe(
      `U_USER:D_DMCHANNEL:${A_TS}`,
    );
  });

  // 첫 질문의 문답이 스레드 키에 쌓이면 두 번째 질문부터는 channel 키를 되짚지 않는다 — 그래도
  // 맡긴 작업 turn 이 보여야 한다.
  it('같은 스레드에서 두 번째로 진행을 물어도 작업 turn 을 넘긴다', async () => {
    const DM_TS = '1730000000.000001';
    const unknown = () =>
      new RouterException({
        code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
        message: '의도 분류 실패 — UNKNOWN',
        status: DomainStatus.BAD_REQUEST,
      });
    const dispatch = jest
      .fn()
      .mockResolvedValueOnce({
        agentRunId: 0,
        workerType: AgentType.BLOG,
        output: { async: true },
        modelUsed: 'hermes-cli',
        formattedText: '📝 블로그 초안 작성을 시작했어요.',
      } satisfies DispatchResult)
      .mockRejectedValue(unknown());
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('아직 쓰고 있어요.'),
    } as unknown as ConversationalReplyUsecase;
    const conversationMemory = new ConversationMemoryService();
    const { app, getHandler } = buildAppMock();
    buildHandler(
      { dispatch },
      { conversationalReply, conversationMemory },
    ).register(app);
    // 그 앞의 다른 최상위 대화 — 스레드로 옮겨 오면 안 된다.
    await conversationMemory.appendTurn('U_USER:D_DMCHANNEL', {
      role: 'user',
      text: '오늘 일정 뭐야',
      agentType: null,
      agentRunId: null,
      timestampMs: Date.now(),
    });
    const client = {
      reactions: {
        add: jest.fn().mockResolvedValue({ ok: true }),
        remove: jest.fn().mockResolvedValue({ ok: true }),
      },
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [{ ts: DM_TS, text: '프롬프트 RAG 블로그 써줘' }],
        }),
      },
    };
    const invoke = getHandler('message') as unknown as (args: {
      event: Record<string, unknown>;
      say: jest.Mock;
      client: unknown;
    }) => Promise<void>;

    await invoke({
      event: {
        type: 'message',
        user: 'U_USER',
        text: '프롬프트 RAG 블로그 써줘',
        ts: DM_TS,
        channel: 'D_DMCHANNEL',
        channel_type: 'im',
      },
      say: jest.fn(),
      client,
    });
    for (const ts of [
      '1730000000.000002',
      '1730000000.000003',
      '1730000000.000004',
      '1730000000.000005',
    ]) {
      await invoke({
        event: {
          type: 'message',
          user: 'U_USER',
          text: '너 작업하고 있어?',
          ts,
          thread_ts: DM_TS,
          channel: 'D_DMCHANNEL',
          channel_type: 'im',
        },
        say: jest.fn(),
        client,
      });
    }

    const second = (conversationalReply.reply as jest.Mock).mock
      .calls[1][0] as { priorTurns: ConversationTurn[] };
    expect(dispatch.mock.calls[0][0].replyContext?.replyThreadKey).toBe(
      `U_USER:D_DMCHANNEL:${DM_TS}`,
    );
    expect(second.priorTurns.map((turn) => turn.text)).not.toContain(
      '오늘 일정 뭐야',
    );
    expect(second.priorTurns).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        agentType: AgentType.BLOG,
      }),
    );
    // 네 번째 질문 — 5 turn 창에서 ack 가 밀려났다. 그래도 넘기는 대화 키가 실행에 남긴 답장 스레드
    // 키와 같아 원장에서 이 실행을 찾는다.
    const fourth = (conversationalReply.reply as jest.Mock).mock
      .calls[3][0] as {
      priorTurns: ConversationTurn[];
      conversationKey: string;
    };
    expect(
      fourth.priorTurns.some((saved) => saved.agentType === AgentType.BLOG),
    ).toBe(false);
    expect(fourth.conversationKey).toBe(`U_USER:D_DMCHANNEL:${DM_TS}`);
  });

  // #836 리뷰 — 같은 문구의 앞선 DM, 부모 뒤에 이어진 다른 최상위 대화는 옮기지 않는다.
  it('스레드로 옮겨 담는 것은 최근 부모 발화와 그 답뿐이다', async () => {
    const DM_TS = '1730000000.000005';
    const conversationMemory = new ConversationMemoryService();
    const channelKey = 'U_USER:D_DMCHANNEL';
    const turn = (
      role: 'user' | 'assistant',
      text: string,
      agentType: AgentType | null,
      agentRunId: number | null,
    ): ConversationTurn => ({
      role,
      text,
      agentType,
      agentRunId,
      timestampMs: Date.now(),
    });
    for (const seeded of [
      turn('user', '블로그 써줘', AgentType.BLOG, 0),
      turn('assistant', '예전 초안 시작', AgentType.BLOG, 0),
      turn('user', '블로그 써줘', AgentType.BLOG, 0),
      turn('assistant', '새 초안 시작', AgentType.BLOG, 0),
      turn('user', '오늘 plan 짜줘', AgentType.PM, 77),
    ]) {
      await conversationMemory.appendTurn(channelKey, seeded);
    }
    const dispatch = jest.fn().mockRejectedValue(
      new RouterException({
        code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
        message: '의도 분류 실패 — UNKNOWN',
        status: DomainStatus.BAD_REQUEST,
      }),
    );
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('아직 쓰고 있어요.'),
    } as unknown as ConversationalReplyUsecase;
    const { app, getHandler } = buildAppMock();
    buildHandler(
      { dispatch },
      { conversationMemory, conversationalReply },
    ).register(app);
    const invoke = getHandler('message') as unknown as (args: {
      event: Record<string, unknown>;
      say: jest.Mock;
      client: unknown;
    }) => Promise<void>;

    await invoke({
      event: {
        type: 'message',
        user: 'U_USER',
        text: '너 작업하고 있어?',
        ts: '1730000000.000009',
        thread_ts: DM_TS,
        channel: 'D_DMCHANNEL',
        channel_type: 'im',
      },
      say: jest.fn(),
      client: {
        reactions: {
          add: jest.fn().mockResolvedValue({ ok: true }),
          remove: jest.fn().mockResolvedValue({ ok: true }),
        },
        conversations: {
          replies: jest.fn().mockResolvedValue({
            messages: [{ ts: DM_TS, text: '블로그 써줘' }],
          }),
        },
      },
    });

    const threadTurns = await conversationMemory.getRecentTurns(
      `${channelKey}:${DM_TS}`,
    );
    expect(threadTurns.slice(0, 2)).toEqual([
      expect.objectContaining({ text: '블로그 써줘' }),
      expect.objectContaining({ text: '새 초안 시작' }),
    ]);
    expect(threadTurns.map((saved) => saved.text)).not.toContain(
      '오늘 plan 짜줘',
    );
    // 첫 질문의 맥락에서도 부모 뒤의 다른 최상위 대화는 빠진다. 앞의 대화는 남는다.
    const first = (conversationalReply.reply as jest.Mock).mock.calls[0][0] as {
      priorTurns: ConversationTurn[];
    };
    expect(first.priorTurns.map((saved) => saved.text)).toEqual([
      '블로그 써줘',
      '예전 초안 시작',
      '블로그 써줘',
      '새 초안 시작',
    ]);
  });

  // 10-14 실측 — 완료 답장은 완료 시점에 channel 키에 쌓여 다른 최상위 요청 뒤에 놓인다. B 스레드에
  // 처음 들어올 때 A 의 완료 답장(실행 id 포함)을 옮기면 B 를 A 의 상태로 답한다.
  it('스레드로 옮길 때 다른 스레드에 게시된 완료 답장은 빼고 자기 스레드 것만 담는다', async () => {
    const A_TS = '1730000000.000001';
    const B_TS = '1730000000.000002';
    const channelKey = 'U_USER:D_DMCHANNEL';
    const conversationMemory = new ConversationMemoryService();
    const seeded: ConversationTurn[] = [
      {
        role: 'user',
        text: 'A 블로그 써줘',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: Date.now(),
      },
      {
        role: 'assistant',
        text: 'A 시작',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: Date.now(),
      },
      {
        role: 'user',
        text: 'B 블로그 써줘',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: Date.now(),
      },
      {
        role: 'assistant',
        text: 'B 시작',
        agentType: AgentType.BLOG,
        agentRunId: 0,
        timestampMs: Date.now(),
      },
      {
        role: 'assistant',
        text: 'A 완료',
        agentType: AgentType.BLOG,
        agentRunId: 41,
        timestampMs: Date.now(),
        replyThreadKey: `${channelKey}:${A_TS}`,
      },
    ];
    for (const turn of seeded) {
      await conversationMemory.appendTurn(channelKey, turn);
    }
    const dispatch = jest.fn().mockRejectedValue(
      new RouterException({
        code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
        message: '의도 분류 실패 — UNKNOWN',
        status: DomainStatus.BAD_REQUEST,
      }),
    );
    const conversationalReply = {
      reply: jest.fn().mockResolvedValue('확인해 볼게요.'),
    } as unknown as ConversationalReplyUsecase;
    const { app, getHandler } = buildAppMock();
    buildHandler(
      { dispatch },
      { conversationMemory, conversationalReply },
    ).register(app);
    const invoke = getHandler('message') as unknown as (args: {
      event: Record<string, unknown>;
      say: jest.Mock;
      client: unknown;
    }) => Promise<void>;
    const roots: Record<string, string> = {
      [A_TS]: 'A 블로그 써줘',
      [B_TS]: 'B 블로그 써줘',
    };
    const askIn = async (threadTs: string, ts: string) =>
      await invoke({
        event: {
          type: 'message',
          user: 'U_USER',
          text: '너 작업하고 있어?',
          ts,
          thread_ts: threadTs,
          channel: 'D_DMCHANNEL',
          channel_type: 'im',
        },
        say: jest.fn(),
        client: {
          reactions: {
            add: jest.fn().mockResolvedValue({ ok: true }),
            remove: jest.fn().mockResolvedValue({ ok: true }),
          },
          conversations: {
            replies: jest.fn().mockResolvedValue({
              messages: [{ ts: threadTs, text: roots[threadTs] }],
            }),
          },
        },
      });

    await askIn(B_TS, '1730000000.000010');
    await askIn(A_TS, '1730000000.000011');

    const texts = (call: number) =>
      (
        (conversationalReply.reply as jest.Mock).mock.calls[call][0] as {
          priorTurns: ConversationTurn[];
        }
      ).priorTurns.map((turn) => turn.text);
    expect(texts(0).slice(-2)).toEqual(['B 블로그 써줘', 'B 시작']);
    expect(texts(0)).not.toContain('A 완료');
    expect(texts(1)).toEqual(['A 블로그 써줘', 'A 시작', 'A 완료']);
    expect(
      (await conversationMemory.getRecentTurns(`${channelKey}:${B_TS}`)).map(
        (turn) => turn.text,
      ),
    ).not.toContain('A 완료');
  });

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
        // DM 최상위 발화라 기억 키는 channel 단위다 — 답장 스레드(threadTs)와 다르다.
        conversationKey: 'U_USER:D_DMCHANNEL',
        // 답장은 그 발화의 스레드에 달린다 — 실행 기록이 그 스레드에서도 찾히게 함께 남긴다.
        replyThreadKey: 'U_USER:D_DMCHANNEL:1730000000.000001',
        rememberReply: expect.any(Function),
        markFinalReplyPending: expect.any(Function),
        recordFinalReply: expect.any(Function),
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

  // 부모 조회가 성공하는 운영 환경에서도 같은 흐름이 뒤틀리지 않아야 한다 — 부모(1턴 발화)가
  // 이미 channel 키에 있으므로 다시 붙이면 user → assistant → 같은 user 순서가 된다.
  it('DM 스레드 부모가 이미 channel 메모리에 있으면 중복해 싣지 않는다', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 5,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: 'DM body',
    });
    const { handler } = buildWithRouter(dispatch);
    const replies = jest.fn().mockResolvedValue({
      messages: [{ ts: '1730000000.000001', text: '가상 계좌 수익률 어때' }],
    });
    const client = {
      reactions: {
        add: jest.fn().mockResolvedValue({ ok: true }),
        remove: jest.fn().mockResolvedValue({ ok: true }),
      },
      conversations: { replies },
    };
    const invoke = handler as unknown as (args: {
      event: Record<string, unknown>;
      say: jest.Mock;
      client: unknown;
    }) => Promise<void>;

    await invoke({
      event: {
        type: 'message',
        user: 'U_USER',
        text: '가상 계좌 수익률 어때',
        ts: '1730000000.000001',
        channel: 'D_DMCHANNEL',
        channel_type: 'im',
      },
      say: jest.fn(),
      client,
    });
    await invoke({
      event: {
        type: 'message',
        user: 'U_USER',
        text: '로컬에 있는 가상계좌',
        ts: '1730000000.000002',
        thread_ts: '1730000000.000001',
        channel: 'D_DMCHANNEL',
        channel_type: 'im',
      },
      say: jest.fn(),
      client,
    });

    expect(replies).toHaveBeenCalledTimes(1);
    const secondCall = dispatch.mock.calls[1][0] as DispatchInput;
    expect(secondCall.priorTurns?.map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
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

  // CTO 분배 확정 — 슬래시(`/be plan ...`) 대신 "응" 한 마디로 BE worker 를 실행하는 경로.
  it('CTO 분배 카드 + "응" → 카드 apply (BE chain 실행)', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn();
    const pending = buildPendingPreview({
      kind: PREVIEW_KIND.PM_WRITE_BACK,
    });
    const applyPreviewUsecase = {
      execute: jest.fn().mockResolvedValue({
        preview: pending,
        resultText: '🚀 BE chain 실행 완료 — 2/2건 성공',
      }),
    } as unknown as ApplyPreviewUsecase;

    buildHandler(
      { dispatch },
      {
        findLatestPendingPreview: {
          execute: jest.fn().mockResolvedValue(pending),
        } as unknown as FindLatestPendingPreviewUsecase,
        applyPreviewUsecase,
        cancelPreviewUsecase: {
          execute: jest.fn(),
        } as unknown as CancelPreviewUsecase,
      },
    ).register(app);

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
        text: expect.stringContaining('BE chain 실행 완료'),
      }),
    );
  });

  // 재배정 지시가 승인으로 새면, 사용자가 고치려던 분배가 그대로 실행돼버린다.
  // Y/N 인터셉트를 통과해 CTO 재분배(dispatch)로 가야 한다.
  it('CTO 분배 카드 + 재배정 문장 → apply 하지 않고 worker dispatch 로 넘김', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 7,
      workerType: AgentType.CTO_STUDY,
      output: {},
      modelUsed: 'codex-cli',
      formattedText: '재분배 결과',
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
          execute: jest
            .fn()
            .mockResolvedValue(
              buildPendingPreview({ kind: PREVIEW_KIND.PM_WRITE_BACK }),
            ),
        } as unknown as FindLatestPendingPreviewUsecase,
        applyPreviewUsecase,
        cancelPreviewUsecase,
      },
    ).register(app);

    await invokeHandler(getHandler('app_mention'), {
      ...baseEvent,
      text: '<@UBOT> 3번은 스키마 말고 테스트로 해줘',
    });

    expect(applyPreviewUsecase.execute).not.toHaveBeenCalled();
    expect(cancelPreviewUsecase.execute).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
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

describe('RouterMessageHandler — 원장 답글 집계', () => {
  const buildCase = () => {
    const { app, getHandler } = buildAppMock();
    const incrementReplyCount = jest.fn().mockResolvedValue(1);
    const dispatch = jest.fn().mockResolvedValue({
      agentRunId: 1,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: '응답',
    });
    buildHandler(
      { dispatch },
      {
        deliveryRepository: {
          incrementReplyCount,
        } as unknown as SlackDeliveryRepositoryPort,
      },
    ).register(app);
    return { getHandler, incrementReplyCount, dispatch };
  };

  it('스레드 멘션은 실제 thread_ts 로 집계한다', async () => {
    const { getHandler, incrementReplyCount } = buildCase();
    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      channel: 'C_CHANNEL',
      ts: '200.001',
      thread_ts: '100.001',
      text: '<@UBOT> 질문',
    });
    expect(incrementReplyCount).toHaveBeenCalledWith({
      channelId: 'C_CHANNEL',
      messageTs: '100.001',
    });
  });

  it('최상위 멘션은 자신의 ts 를 답글로 세지 않는다', async () => {
    const { getHandler, incrementReplyCount } = buildCase();
    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      channel: 'C_CHANNEL',
      ts: '200.001',
      text: '<@UBOT> 질문',
    });
    expect(incrementReplyCount).not.toHaveBeenCalled();
  });

  it('스레드 DM 만 실제 thread_ts 로 집계한다', async () => {
    const { getHandler, incrementReplyCount } = buildCase();
    await invokeHandler(getHandler('message'), {
      type: 'message',
      channel_type: 'im',
      user: 'U_USER',
      channel: 'D_CHANNEL',
      ts: '200.001',
      thread_ts: '100.001',
      text: '질문',
    });
    expect(incrementReplyCount).toHaveBeenCalledWith({
      channelId: 'D_CHANNEL',
      messageTs: '100.001',
    });
  });

  it('최상위 DM 은 답글로 세지 않는다', async () => {
    const { getHandler, incrementReplyCount } = buildCase();
    await invokeHandler(getHandler('message'), {
      type: 'message',
      channel_type: 'im',
      user: 'U_USER',
      channel: 'D_CHANNEL',
      ts: '200.001',
      text: '질문',
    });
    expect(incrementReplyCount).not.toHaveBeenCalled();
  });

  it('집계 실패해도 대화를 dispatch 한다', async () => {
    const { getHandler, incrementReplyCount, dispatch } = buildCase();
    incrementReplyCount.mockRejectedValue(new Error('DB 오류'));
    await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      channel: 'C_CHANNEL',
      ts: '200.001',
      thread_ts: '100.001',
      text: '<@UBOT> 질문',
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('RouterMessageHandler — 멘션 수신 기록', () => {
  const mention = {
    type: 'app_mention',
    user: 'U_USER',
    channel: 'C_CHANNEL',
    ts: '300.001',
    text: '<@UBOT> 오늘 할 일',
  };
  const ref = { channelId: 'C_CHANNEL', messageTs: '300.001' };

  const buildCase = (dispatch: jest.Mock) => {
    const { app, getHandler } = buildAppMock();
    const receipts = {
      recordReceived: jest.fn().mockResolvedValue(undefined),
      recordOutcome: jest.fn().mockResolvedValue(undefined),
      recordFinalReply: jest.fn().mockResolvedValue(undefined),
    };
    buildHandler({ dispatch }, { mentionReceiptRepository: receipts }).register(
      app,
    );
    return { handler: getHandler('app_mention'), receipts };
  };

  const okDispatch = () =>
    jest.fn().mockResolvedValue({
      agentRunId: 1,
      workerType: AgentType.PM,
      output: {},
      modelUsed: 'mock',
      formattedText: '응답',
    });

  it('수신을 먼저 남기고 답이 게시되면 REPLIED 로 닫는다', async () => {
    const { handler, receipts } = buildCase(okDispatch());
    await invokeHandler(handler, mention);
    expect(receipts.recordReceived).toHaveBeenCalledWith({
      ...ref,
      source: 'app_mention',
    });
    expect(receipts.recordOutcome).toHaveBeenCalledWith({
      ...ref,
      status: 'REPLIED',
    });
  });

  it('처리 실패 안내만 나가면 ERROR_REPLIED 다', async () => {
    const { handler, receipts } = buildCase(
      jest.fn().mockRejectedValue(new Error('router down')),
    );
    await invokeHandler(handler, mention);
    expect(receipts.recordOutcome).toHaveBeenCalledWith({
      ...ref,
      status: 'ERROR_REPLIED',
    });
  });

  it('게시가 전부 실패하면 REPLY_FAILED 와 Slack 오류를 남긴다', async () => {
    const { handler, receipts } = buildCase(okDispatch());
    const say = jest.fn().mockRejectedValue(new Error('channel_not_found'));
    const client = {
      reactions: {
        add: jest.fn().mockResolvedValue({ ok: true }),
        remove: jest.fn().mockResolvedValue({ ok: true }),
      },
    };
    await expect(handler({ event: mention, say, client })).rejects.toThrow(
      'channel_not_found',
    );
    expect(receipts.recordOutcome).toHaveBeenCalledWith({
      ...ref,
      status: 'REPLY_FAILED',
      errorMessage: 'channel_not_found',
    });
  });

  it('비동기 담당의 결과 답장 대기·게시 결과를 같은 멘션에 기록한다', async () => {
    const dispatch = jest.fn(async (input: DispatchInput) => {
      await input.replyContext?.markFinalReplyPending?.();
      await input.replyContext?.recordFinalReply?.(false);
      return {
        agentRunId: 0,
        workerType: AgentType.BLOG,
        output: { async: true },
        modelUsed: 'hermes-cli',
        formattedText: '작성을 시작했어요',
      };
    });
    const { handler, receipts } = buildCase(dispatch);
    await invokeHandler(handler, mention);
    expect(receipts.recordFinalReply.mock.calls).toEqual([
      [{ ...ref, status: 'PENDING' }],
      [{ ...ref, status: 'FAILED' }],
    ]);
  });

  it('기록이 실패해도 답변은 나간다', async () => {
    const { app, getHandler } = buildAppMock();
    buildHandler(
      { dispatch: okDispatch() },
      {
        mentionReceiptRepository: {
          recordReceived: jest.fn().mockRejectedValue(new Error('db down')),
          recordOutcome: jest.fn().mockRejectedValue(new Error('db down')),
          recordFinalReply: jest.fn().mockRejectedValue(new Error('db down')),
        },
      },
    ).register(app);
    const { say } = await invokeHandler(getHandler('app_mention'), mention);
    expect(say).toHaveBeenCalledTimes(1);
  });
});

// #839 리뷰 — 완료 답장은 동기 답보다 먼저 끼어들 수도 있다(user turn 저장 뒤 say 를 기다리는 사이).
describe('pickThreadReplies', () => {
  const B_THREAD = 'U:D:B';
  const turn = (
    role: 'user' | 'assistant',
    text: string,
    replyThreadKey?: string,
  ): ConversationTurn => ({
    role,
    text,
    agentType: AgentType.BLOG,
    agentRunId: 0,
    timestampMs: 0,
    ...(replyThreadKey ? { replyThreadKey } : {}),
  });

  it('동기 답 앞에 다른 스레드 완료 답장이 끼어도 동기 답을 고른다', () => {
    expect(
      pickThreadReplies({
        turnsAfterRoot: [
          turn('assistant', 'A 완료', 'U:D:A'),
          turn('assistant', 'B 시작'),
        ],
        threadKey: B_THREAD,
      }).map((picked) => picked.text),
    ).toEqual(['B 시작']);
  });

  it('다음 요청 뒤의 표시 없는 답은 고르지 않고, 이 스레드 완료 답장은 어디 있든 고른다', () => {
    expect(
      pickThreadReplies({
        turnsAfterRoot: [
          turn('assistant', 'B 시작'),
          turn('user', 'C 써줘'),
          turn('assistant', 'C 시작'),
          turn('assistant', 'B 완료', B_THREAD),
        ],
        threadKey: B_THREAD,
      }).map((picked) => picked.text),
    ).toEqual(['B 시작', 'B 완료']);
  });

  it('부모 발화에 답이 없으면(처리 실패) 다음 요청의 답을 끌어오지 않는다', () => {
    expect(
      pickThreadReplies({
        turnsAfterRoot: [turn('user', 'C 써줘'), turn('assistant', 'C 시작')],
        threadKey: B_THREAD,
      }),
    ).toEqual([]);
  });
});
