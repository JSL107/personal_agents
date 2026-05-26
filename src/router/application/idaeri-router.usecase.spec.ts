import { Logger } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { DispatchInput } from '../domain/idaeri-router.port';
import { IntentClassification } from '../domain/intent-classification.type';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../domain/port/agent-dispatcher.port';
import { RouterErrorCode } from '../domain/router-error-code.enum';
import { IdaeriRouterUsecase } from './idaeri-router.usecase';
import { IntentClassifierUsecase } from './intent-classifier.usecase';

const buildDispatcher = (
  agentType: AgentType,
  outcomeFn: (input: DispatchInput) => DispatchOutcome,
): AgentDispatcher => ({
  agentType,
  dispatch: jest.fn(async (input: DispatchInput) => outcomeFn(input)),
});

const buildClassifierMock = (
  classification: IntentClassification,
): jest.Mocked<IntentClassifierUsecase> =>
  ({
    classify: jest.fn().mockResolvedValue(classification),
  }) as unknown as jest.Mocked<IntentClassifierUsecase>;

const buildUsecase = (
  dispatchers: AgentDispatcher[] = [],
  classifier: jest.Mocked<IntentClassifierUsecase> = buildClassifierMock({
    agentType: 'UNKNOWN',
    confidence: 0,
    reason: 'default mock',
  }),
): {
  usecase: IdaeriRouterUsecase;
  classifier: jest.Mocked<IntentClassifierUsecase>;
} => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return {
    usecase: new IdaeriRouterUsecase(dispatchers, classifier),
    classifier,
  };
};

describe('IdaeriRouterUsecase', () => {
  it('agentTypeHint 도 text 도 없으면 INTENT_HINT_REQUIRED throw', async () => {
    const { usecase, classifier } = buildUsecase();

    await expect(
      usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.INTENT_HINT_REQUIRED,
    });
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('등록된 dispatcher 의 agentType 으로 호출하면 dispatcher.dispatch 결과를 그대로 반환', async () => {
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 42,
      output: { topPriority: ['mock'] },
      modelUsed: 'gpt-5-mock',
    }));
    const { usecase, classifier } = buildUsecase([pmDispatcher]);

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
    // hint 있으면 classifier 미호출.
    expect(classifier.classify).not.toHaveBeenCalled();
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
    const { usecase } = buildUsecase([pmDispatcher]);

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
    const { usecase } = buildUsecase([pmDispatcher]);

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

  it('agentTypeHint 없고 text 있으면 classifier 호출 후 분류된 agentType 으로 dispatch', async () => {
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 99,
      output: { plan: 'classified' },
      modelUsed: 'mock',
    }));
    const classifier = buildClassifierMock({
      agentType: AgentType.PM,
      confidence: 0.9,
      reason: '일정 키워드 매칭',
    });
    const { usecase } = buildUsecase([pmDispatcher], classifier);

    const result = await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '오늘 plan 짜줘',
    });

    expect(classifier.classify).toHaveBeenCalledWith('오늘 plan 짜줘');
    expect(result.workerType).toBe(AgentType.PM);
    expect(result.output).toEqual({ plan: 'classified' });
  });

  it('classifier 가 UNKNOWN 반환하면 INTENT_CLASSIFY_FAILED throw', async () => {
    const classifier = buildClassifierMock({
      agentType: 'UNKNOWN',
      confidence: 0,
      reason: '의도 모호',
    });
    const { usecase } = buildUsecase([], classifier);

    await expect(
      usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '랜덤 텍스트',
      }),
    ).rejects.toMatchObject({
      routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
    });
  });
});
