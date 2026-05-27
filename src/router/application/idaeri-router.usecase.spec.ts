import { Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
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
  outcomeFn: (
    input: DispatchInput,
  ) => Partial<DispatchOutcome> & { agentRunId: number },
): AgentDispatcher => ({
  agentType,
  dispatch: jest.fn(async (input: DispatchInput) => {
    const partial = outcomeFn(input);
    return {
      output: {},
      modelUsed: 'mock-model',
      formattedText: `mock formatted text for ${agentType}`,
      ...partial,
    } as DispatchOutcome;
  }),
});

const buildClassifierMock = (
  classification: IntentClassification,
): jest.Mocked<IntentClassifierUsecase> =>
  ({
    classify: jest.fn().mockResolvedValue(classification),
  }) as unknown as jest.Mocked<IntentClassifierUsecase>;

const buildAgentRunServiceMock = (): jest.Mocked<AgentRunService> =>
  ({
    setParentId: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<AgentRunService>;

const buildUsecase = (
  dispatchers: AgentDispatcher[] = [],
  classifier: jest.Mocked<IntentClassifierUsecase> = buildClassifierMock({
    agentType: 'UNKNOWN',
    confidence: 0,
    reason: 'default mock',
  }),
  agentRunService: jest.Mocked<AgentRunService> = buildAgentRunServiceMock(),
): {
  usecase: IdaeriRouterUsecase;
  classifier: jest.Mocked<IntentClassifierUsecase>;
  agentRunService: jest.Mocked<AgentRunService>;
} => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return {
    usecase: new IdaeriRouterUsecase(dispatchers, classifier, agentRunService),
    classifier,
    agentRunService,
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

  describe('Handoff chain (step 6)', () => {
    it('worker 가 followUp 반환하면 manager 가 다음 worker 로 재 dispatch + 최종 worker 결과 반환', async () => {
      const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
        agentRunId: 1,
        output: { plan: 'PM result' },
        modelUsed: 'pm-mock',
        followUp: {
          toWorker: AgentType.BE,
          reason: 'PM 이 BE 검토 요청',
          passthroughInput: { text: 'user repository 만들어줘' },
        },
      }));
      const beDispatcher = buildDispatcher(AgentType.BE, () => ({
        agentRunId: 2,
        output: { plan: 'BE result' },
        modelUsed: 'be-mock',
      }));
      const { usecase, agentRunService } = buildUsecase([
        pmDispatcher,
        beDispatcher,
      ]);

      const result = await usecase.dispatch({
        source: 'SLACK_COMMAND',
        slackUserId: 'U1',
        agentTypeHint: AgentType.PM,
        text: 'plan today',
      });

      // 최종 반환은 chain 의 마지막 worker (BE) 결과.
      expect(result.agentRunId).toBe(2);
      expect(result.workerType).toBe(AgentType.BE);
      expect(result.output).toEqual({ plan: 'BE result' });

      // BE dispatcher 가 passthroughInput.text 와 parent contextRefs 로 호출됐는지.
      expect(beDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'SLACK_COMMAND',
          agentTypeHint: AgentType.BE,
          text: 'user repository 만들어줘',
          contextRefs: { agentRunId: 1 },
        }),
      );

      // step 8 — child run (BE: id=2) 에 parent (PM: id=1) 가 기록됐는지.
      // root entry (PM) 는 contextRefs 가 없어 setParentId 호출 X — child 만 1회 호출.
      expect(agentRunService.setParentId).toHaveBeenCalledTimes(1);
      expect(agentRunService.setParentId).toHaveBeenCalledWith({
        id: 2,
        parentId: 1,
      });
    });

    it('chain 안 같은 worker 가 재진입하면 CYCLE_DETECTED', async () => {
      const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
        agentRunId: 10,
        output: {},
        modelUsed: 'pm-mock',
        followUp: {
          toWorker: AgentType.BE,
          reason: 'PM → BE',
          passthroughInput: {},
        },
      }));
      const beDispatcher = buildDispatcher(AgentType.BE, () => ({
        agentRunId: 11,
        output: {},
        modelUsed: 'be-mock',
        followUp: {
          // 같은 PM 으로 다시 — cycle.
          toWorker: AgentType.PM,
          reason: 'BE → PM (cycle)',
          passthroughInput: {},
        },
      }));
      const { usecase } = buildUsecase([pmDispatcher, beDispatcher]);

      await expect(
        usecase.dispatch({
          source: 'SLACK_COMMAND',
          slackUserId: 'U1',
          agentTypeHint: AgentType.PM,
        }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.CYCLE_DETECTED,
      });
    });

    it('chain 깊이가 MAX_HANDOFF_DEPTH(3) 초과면 DEPTH_EXCEEDED', async () => {
      // 4 worker 모두 다음 worker 로 followUp — 깊이 4 가 되어 throw 예상.
      // 본 spec 은 visited 목록이 distinct 이라 cycle 검출 X, 오직 depth 가드만 동작.
      const chainOrder = [
        AgentType.PM,
        AgentType.WORK_REVIEWER,
        AgentType.IMPACT_REPORTER,
        AgentType.PO_SHADOW,
        AgentType.CODE_REVIEWER,
      ];
      const dispatchers = chainOrder.map((type, idx) =>
        buildDispatcher(type, () => ({
          agentRunId: idx + 1,
          output: {},
          modelUsed: 'mock',
          followUp: chainOrder[idx + 1]
            ? {
                toWorker: chainOrder[idx + 1],
                reason: `${type} → next`,
                passthroughInput: {},
              }
            : undefined,
        })),
      );
      const { usecase } = buildUsecase(dispatchers);

      await expect(
        usecase.dispatch({
          source: 'SLACK_COMMAND',
          slackUserId: 'U1',
          agentTypeHint: AgentType.PM,
        }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.DEPTH_EXCEEDED,
      });
    });

    it('followUp 의 toWorker 가 미등록 dispatcher 면 UNSUPPORTED_AGENT_TYPE (chain 도중 throw)', async () => {
      const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
        agentRunId: 1,
        output: {},
        modelUsed: 'mock',
        followUp: {
          toWorker: AgentType.BE_TEST,
          reason: 'PM → BE_TEST',
          passthroughInput: {},
        },
      }));
      // BE_TEST dispatcher 미등록.
      const { usecase } = buildUsecase([pmDispatcher]);

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
});
