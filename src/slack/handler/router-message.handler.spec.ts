import { App } from '@slack/bolt';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
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
  conversationMemory: ConversationMemoryService = new ConversationMemoryService(),
): RouterMessageHandler =>
  new RouterMessageHandler(idaeriRouter, conversationMemory);

type EventHandler = (args: {
  event: Record<string, unknown>;
  say: jest.Mock;
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
): Promise<{ say: jest.Mock }> => {
  const say = jest.fn();
  await handler({ event: event as Record<string, unknown>, say });
  return { say };
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

  it('router 가 RouterException throw 하면 사용자에게 한국어 메시지로 안내', async () => {
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
    buildHandler(idaeriRouter).register(app);

    const { say } = await invokeHandler(getHandler('app_mention'), {
      type: 'app_mention',
      user: 'U_USER',
      text: '<@UBOT> 랜덤',
      ts: '1730000000.000001',
      channel: 'C_CHANNEL',
    });

    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('의도 분류 실패'),
      }),
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
    } satisfies DispatchInput);
    expect(say).toHaveBeenCalled();
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
