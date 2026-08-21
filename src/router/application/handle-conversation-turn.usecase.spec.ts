import { AgentType } from '../../model-router/domain/model-router.type';
import { DispatchResult, IdaeriRouterPort } from '../domain/idaeri-router.port';
import { RouterException } from '../domain/router.exception';
import { RouterErrorCode } from '../domain/router-error-code.enum';
import { ConversationMemoryService } from './conversation-memory.service';
import { ConversationalReplyUsecase } from './conversational-reply.usecase';
import { HandleConversationTurnUsecase } from './handle-conversation-turn.usecase';

const workerResult: DispatchResult = {
  agentRunId: 42,
  workerType: AgentType.PM,
  output: { plan: 'today' },
  modelUsed: 'mock-model',
  formattedText: '오늘 계획을 정리했습니다.',
};

const buildDependencies = (): {
  router: jest.Mocked<IdaeriRouterPort>;
  conversationMemory: jest.Mocked<ConversationMemoryService>;
  conversationalReply: jest.Mocked<ConversationalReplyUsecase>;
} => ({
  router: {
    dispatch: jest.fn(),
  },
  conversationMemory: {
    getRecentTurns: jest.fn().mockResolvedValue([]),
    appendTurn: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ConversationMemoryService>,
  conversationalReply: {
    reply: jest.fn(),
  } as unknown as jest.Mocked<ConversationalReplyUsecase>,
});

describe('HandleConversationTurnUsecase', () => {
  it('worker 성공 결과와 user/assistant 두 turn을 기억한다', async () => {
    const dependencies = buildDependencies();
    dependencies.router.dispatch.mockResolvedValue(workerResult);
    const usecase = new HandleConversationTurnUsecase(
      dependencies.router,
      dependencies.conversationMemory,
      dependencies.conversationalReply,
    );

    const result = await usecase.execute({
      slackUserId: 'U1',
      conversationKey: 'U1:CONSOLE',
      text: '오늘 계획 짜줘',
      source: 'REMOTE_CONSOLE',
    });

    expect(result).toEqual({ kind: 'WORKER_RAN', result: workerResult });
    expect(dependencies.router.dispatch).toHaveBeenCalledWith({
      slackUserId: 'U1',
      text: '오늘 계획 짜줘',
      source: 'REMOTE_CONSOLE',
      priorTurns: [],
    });
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenCalledTimes(2);
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenNthCalledWith(
      1,
      'U1:CONSOLE',
      expect.objectContaining({
        role: 'user',
        text: '오늘 계획 짜줘',
        agentType: AgentType.PM,
        agentRunId: 42,
      }),
    );
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenNthCalledWith(
      2,
      'U1:CONSOLE',
      expect.objectContaining({
        role: 'assistant',
        text: '오늘 계획을 정리했습니다.',
        agentType: AgentType.PM,
        agentRunId: 42,
      }),
    );
  });

  it('분류 실패는 ConversationalReply로 답하고 두 turn을 기억한다', async () => {
    const dependencies = buildDependencies();
    const priorTurns = [
      {
        role: 'assistant' as const,
        text: '직전 답변',
        agentType: null,
        agentRunId: null,
        timestampMs: 1,
      },
    ];
    dependencies.router.dispatch.mockRejectedValue(
      new RouterException({
        message: '분류 실패',
        code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      }),
    );
    dependencies.conversationalReply.reply.mockResolvedValue(
      '대화로 답변했습니다.',
    );
    const usecase = new HandleConversationTurnUsecase(
      dependencies.router,
      dependencies.conversationMemory,
      dependencies.conversationalReply,
    );

    const result = await usecase.execute({
      slackUserId: 'U1',
      conversationKey: 'U1:CONSOLE',
      text: '안녕',
      source: 'REMOTE_CONSOLE',
      priorTurns,
      unresolvedStreak: 2,
    });

    expect(result).toEqual({ kind: 'REPLIED', text: '대화로 답변했습니다.' });
    expect(
      dependencies.conversationMemory.getRecentTurns,
    ).not.toHaveBeenCalled();
    expect(dependencies.conversationalReply.reply).toHaveBeenCalledWith({
      text: '안녕',
      priorTurns,
      unresolvedStreak: 2,
    });
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenCalledTimes(2);
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenNthCalledWith(
      1,
      'U1:CONSOLE',
      expect.objectContaining({
        role: 'user',
        text: '안녕',
        agentType: null,
        agentRunId: null,
      }),
    );
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenNthCalledWith(
      2,
      'U1:CONSOLE',
      expect.objectContaining({
        role: 'assistant',
        text: '대화로 답변했습니다.',
        agentType: null,
        agentRunId: null,
      }),
    );
  });

  it('분류 실패 외 예외는 그대로 throw한다', async () => {
    const dependencies = buildDependencies();
    const error = new RouterException({
      message: '지원하지 않는 worker',
      code: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
    });
    dependencies.router.dispatch.mockRejectedValue(error);
    const usecase = new HandleConversationTurnUsecase(
      dependencies.router,
      dependencies.conversationMemory,
      dependencies.conversationalReply,
    );

    await expect(
      usecase.execute({
        slackUserId: 'U1',
        conversationKey: 'U1:CONSOLE',
        text: '실행해줘',
        source: 'REMOTE_CONSOLE',
      }),
    ).rejects.toBe(error);
    expect(dependencies.conversationalReply.reply).not.toHaveBeenCalled();
    expect(dependencies.conversationMemory.appendTurn).not.toHaveBeenCalled();
  });
  it('agentTypeHint 지목으로 text 가 비면 빈 user turn 을 남기지 않는다', async () => {
    const dependencies = buildDependencies();
    dependencies.router.dispatch.mockResolvedValue(workerResult);
    const usecase = new HandleConversationTurnUsecase(
      dependencies.router,
      dependencies.conversationMemory,
      dependencies.conversationalReply,
    );

    await usecase.execute({
      slackUserId: 'U1',
      conversationKey: 'U1:CONSOLE',
      text: '',
      source: 'REMOTE_CONSOLE',
      agentTypeHint: AgentType.PM,
    });

    // 빈 user turn 은 분류기 prompt 에 빈 줄로 들어가고 5턴 한도의 한 칸을 먹는다.
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenCalledTimes(1);
    expect(dependencies.conversationMemory.appendTurn).toHaveBeenCalledWith(
      'U1:CONSOLE',
      expect.objectContaining({ role: 'assistant' }),
    );
  });

  it('shouldRemember=false 인 선행 worker turn 은 기억하지 않는다', async () => {
    const dependencies = buildDependencies();
    dependencies.router.dispatch.mockResolvedValue(workerResult);
    const usecase = new HandleConversationTurnUsecase(
      dependencies.router,
      dependencies.conversationMemory,
      dependencies.conversationalReply,
    );

    const result = await usecase.execute({
      slackUserId: 'U1',
      conversationKey: 'U1:CONSOLE',
      text: '--recent 7d',
      source: 'REMOTE_CONSOLE',
      agentTypeHint: AgentType.IMPACT_REPORTER,
      shouldRemember: false,
    });

    expect(result).toEqual({ kind: 'WORKER_RAN', result: workerResult });
    expect(dependencies.conversationMemory.appendTurn).not.toHaveBeenCalled();
  });
});
