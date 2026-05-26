import { Logger } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { DispatchInput } from '../domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../domain/port/agent-dispatcher.port';
import { RouterErrorCode } from '../domain/router-error-code.enum';
import { IdaeriRouterUsecase } from './idaeri-router.usecase';

const buildDispatcher = (
  agentType: AgentType,
  outcomeFn: (input: DispatchInput) => DispatchOutcome,
): AgentDispatcher => ({
  agentType,
  dispatch: jest.fn(async (input: DispatchInput) => outcomeFn(input)),
});

const buildUsecase = (
  dispatchers: AgentDispatcher[] = [],
): IdaeriRouterUsecase => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return new IdaeriRouterUsecase(dispatchers);
};

describe('IdaeriRouterUsecase', () => {
  it('agentTypeHint 가 없으면 INTENT_HINT_REQUIRED throw — intent classifier 미도입 단계', async () => {
    const usecase = buildUsecase();

    await expect(
      usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '안녕',
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.INTENT_HINT_REQUIRED,
    });
  });

  it('등록된 dispatcher 의 agentType 으로 호출하면 dispatcher.dispatch 결과를 그대로 반환', async () => {
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 42,
      output: { topPriority: ['mock'] },
      modelUsed: 'gpt-5-mock',
    }));
    const usecase = buildUsecase([pmDispatcher]);

    const result = await usecase.dispatch({
      source: 'SLACK_COMMAND',
      slackUserId: 'U1',
      agentTypeHint: AgentType.PM,
      text: 'plan today',
    });

    expect(result.agentRunId).toBe(42);
    expect(result.workerType).toBe(AgentType.PM);
    expect(result.modelUsed).toBe('gpt-5-mock');
    expect(result.output).toEqual({ topPriority: ['mock'] });
    expect(pmDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'SLACK_COMMAND',
        slackUserId: 'U1',
        agentTypeHint: AgentType.PM,
        text: 'plan today',
      }),
    );
  });

  it('dispatcher 가 followUp 반환하면 DispatchResult 에 그대로 전달', async () => {
    const followUp = {
      toWorker: AgentType.BE,
      reason: 'PM 이 BE 검토 요청',
      passthroughInput: { topic: 'schema 변경' },
    };
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 7,
      output: {},
      modelUsed: 'gpt-5-mock',
      followUp,
    }));
    const usecase = buildUsecase([pmDispatcher]);

    const result = await usecase.dispatch({
      source: 'CRON',
      slackUserId: 'U1',
      agentTypeHint: AgentType.PM,
    });

    expect(result.followUp).toEqual(followUp);
  });

  it('등록되지 않은 agentType 은 UNSUPPORTED_AGENT_TYPE throw (다른 dispatcher 등록 무관)', async () => {
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 1,
      output: {},
      modelUsed: 'mock',
    }));
    const usecase = buildUsecase([pmDispatcher]);

    await expect(
      usecase.dispatch({
        source: 'SLACK_COMMAND',
        slackUserId: 'U1',
        agentTypeHint: AgentType.BE_TEST,
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
    });
  });

  it('dispatchers 배열이 비어 있어도 INTENT_HINT_REQUIRED / UNSUPPORTED_AGENT_TYPE 분기 동작', async () => {
    const usecase = buildUsecase([]);

    await expect(
      usecase.dispatch({
        source: 'SLACK_COMMAND',
        slackUserId: 'U1',
        agentTypeHint: AgentType.PM,
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
    });
  });
});
