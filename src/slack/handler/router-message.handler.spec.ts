import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  DispatchInput,
  DispatchResult,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { RouterException } from '../../router/domain/router.exception';
import { RouterErrorCode } from '../../router/domain/router-error-code.enum';
import { registerRouterMessageHandler } from './router-message.handler';

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

const buildAppMock = (): {
  app: App;
  getHandler: () => EventHandler;
} => {
  let captured: EventHandler | undefined;
  const app = {
    event: jest.fn((type: string, handler: EventHandler) => {
      if (type === 'app_mention') {
        captured = handler;
      }
    }),
  } as unknown as App;
  return {
    app,
    getHandler: () => {
      if (!captured) {
        throw new Error('app_mention handler 미등록');
      }
      return captured;
    },
  };
};

const createSilentLogger = (): Logger =>
  ({ warn: jest.fn(), log: jest.fn(), error: jest.fn() }) as unknown as Logger;

const invokeHandler = async (
  handler: EventHandler,
  event: AppMentionEvent,
): Promise<{ say: jest.Mock }> => {
  const say = jest.fn();
  await handler({ event: event as Record<string, unknown>, say });
  return { say };
};

describe('registerRouterMessageHandler', () => {
  it('app_mention 이벤트에 핸들러를 등록', () => {
    const { app } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn(),
    };

    registerRouterMessageHandler(app, {
      idaeriRouter,
      logger: createSilentLogger(),
    });

    expect(app.event).toHaveBeenCalledWith('app_mention', expect.any(Function));
  });

  it('멘션 prefix 제거 후 router.dispatch 호출 + 성공 메시지 thread 응답', async () => {
    const { app, getHandler } = buildAppMock();
    const dispatchResult: DispatchResult = {
      agentRunId: 99,
      workerType: AgentType.PM,
      output: { topPriority: [] },
      modelUsed: 'mock-model',
    };
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockResolvedValue(dispatchResult),
    };
    registerRouterMessageHandler(app, {
      idaeriRouter,
      logger: createSilentLogger(),
    });

    const { say } = await invokeHandler(getHandler(), {
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
    } satisfies DispatchInput);
    expect(say).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_ts: '1730000000.000001',
        text: expect.stringContaining('PM'),
      }),
    );
  });

  it('thread_ts 가 있으면 thread 답글 — 새 thread 생성 안 함', async () => {
    const { app, getHandler } = buildAppMock();
    const idaeriRouter: IdaeriRouterPort = {
      dispatch: jest.fn().mockResolvedValue({
        agentRunId: 1,
        workerType: AgentType.PM,
        output: {},
        modelUsed: 'mock',
      }),
    };
    registerRouterMessageHandler(app, {
      idaeriRouter,
      logger: createSilentLogger(),
    });

    const { say } = await invokeHandler(getHandler(), {
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
    registerRouterMessageHandler(app, {
      idaeriRouter,
      logger: createSilentLogger(),
    });

    const { say } = await invokeHandler(getHandler(), {
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
    registerRouterMessageHandler(app, {
      idaeriRouter,
      logger: createSilentLogger(),
    });

    const { say } = await invokeHandler(getHandler(), {
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
    registerRouterMessageHandler(app, {
      idaeriRouter,
      logger: createSilentLogger(),
    });

    const { say } = await invokeHandler(getHandler(), {
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
