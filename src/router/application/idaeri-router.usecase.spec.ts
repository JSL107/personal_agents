import { Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  claimRoutingContext,
  RoutingContext,
} from '../../agent-run/application/routing-context';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
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

// execute 는 진짜와 같은 모양으로 둔다 — run 콜백을 실제로 돌리고 그 거절을 되던진다.
// jest.fn() 만 두면 라우팅 실패 기록이 "불렸다" 까지만 확인되고, 그 안에서 근거를 집어
// 가는지(스코프가 살아 있는지)는 영영 검증되지 않는다.
const buildAgentRunServiceMock = (): jest.Mocked<AgentRunService> =>
  ({
    setParentId: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn(
      async ({
        run,
      }: {
        run: (context: { agentRunId: number }) => unknown;
      }) => {
        await run({ agentRunId: 999 });
        return { result: undefined, modelUsed: 'mock', agentRunId: 999 };
      },
    ),
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
  it('dispatchers 가 array 가 아니면 constructor 가 DISPATCHER_REGISTRY_INVALID throw — NestJS multi-provider 회귀 안전망', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const notArray = {
      agentType: AgentType.PM,
    } as unknown as AgentDispatcher[];
    const classifier = buildClassifierMock({
      agentType: 'UNKNOWN',
      confidence: 0,
      reason: 'noop',
    });
    const agentRunService = buildAgentRunServiceMock();

    expect(
      () => new IdaeriRouterUsecase(notArray, classifier, agentRunService),
    ).toThrow(
      expect.objectContaining({
        routerErrorCode: RouterErrorCode.DISPATCHER_REGISTRY_INVALID,
      }),
    );
  });

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

  it('dispatcher 의 autoResolvedNotice 를 root DispatchResult 로 전달한다', async () => {
    const autoResolvedOutcome = {
      agentRunId: 43,
      output: {},
      modelUsed: 'gpt-5-mock',
      autoResolvedNotice: 'PR #42 를 자동 해결 처리했습니다.',
    };
    const pmDispatcher = buildDispatcher(
      AgentType.PM,
      () => autoResolvedOutcome,
    );
    const { usecase } = buildUsecase([pmDispatcher]);

    const result = await usecase.dispatch({
      source: 'REMOTE_CONSOLE',
      slackUserId: 'U1',
      agentTypeHint: AgentType.PM,
    });

    expect(result).toMatchObject({
      autoResolvedNotice: 'PR #42 를 자동 해결 처리했습니다.',
    });
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
        agentTypeHint: AgentType.PO_SHADOW,
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

    expect(classifier.classify).toHaveBeenCalledWith(
      '오늘 plan 짜줘',
      undefined,
    );
    expect(result.workerType).toBe(AgentType.PM);
    expect(result.output).toEqual({ plan: 'classified' });
  });

  it('회사사람형 닉네임으로 지시하면 classifier 없이 해당 담당자에게 dispatch한다', async () => {
    const reviewerDispatcher = buildDispatcher(AgentType.CODE_REVIEWER, () => ({
      agentRunId: 100,
      output: { summary: 'reviewed' },
      modelUsed: 'mock',
    }));
    const { usecase, classifier } = buildUsecase([reviewerDispatcher]);

    const result = await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '박꼼꼼에게 이 PR 리뷰 맡겨줘 owner/repo#42',
    });

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(result.workerType).toBe(AgentType.CODE_REVIEWER);
    expect(reviewerDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTypeHint: AgentType.CODE_REVIEWER,
        text: '박꼼꼼에게 이 PR 리뷰 맡겨줘 owner/repo#42',
      }),
    );
  });

  it('일반 동사와 우연히 같은 닉네임은 직접 호출로 해석하지 않는다', async () => {
    const blogDispatcher = buildDispatcher(AgentType.BLOG, () => ({
      agentRunId: 101,
      output: {},
      modelUsed: 'mock',
    }));
    const classifier = buildClassifierMock({
      agentType: AgentType.BLOG,
      confidence: 0.9,
      reason: '문서 검토 요청',
    });
    const { usecase } = buildUsecase([blogDispatcher], classifier);

    const result = await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '이 문서를 배포해도 되는지 검토해줘',
    });

    expect(classifier.classify).toHaveBeenCalledWith(
      '이 문서를 배포해도 되는지 검토해줘',
      undefined,
    );
    expect(result.workerType).toBe(AgentType.BLOG);
  });

  it('dispatcher가 없는 내부 담당자 닉네임은 직접 호출하지 않고 classifier로 돌린다', async () => {
    const blogDispatcher = buildDispatcher(AgentType.BLOG, () => ({
      agentRunId: 102,
      output: {},
      modelUsed: 'mock',
    }));
    const classifier = buildClassifierMock({
      agentType: AgentType.BLOG,
      confidence: 0.8,
      reason: '문장 작성 요청',
    });
    const { usecase } = buildUsecase([blogDispatcher], classifier);

    const result = await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '윤다정님 이 문장을 다듬어줘',
    });

    expect(classifier.classify).toHaveBeenCalledWith(
      '윤다정님 이 문장을 다듬어줘',
      undefined,
    );
    expect(result.workerType).toBe(AgentType.BLOG);
  });

  it('여러 담당자를 함께 지칭하면 명부 순서로 한 명을 고르지 않고 classifier로 돌린다', async () => {
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 103,
      output: {},
      modelUsed: 'mock',
    }));
    const reviewerDispatcher = buildDispatcher(AgentType.CODE_REVIEWER, () => ({
      agentRunId: 104,
      output: {},
      modelUsed: 'mock',
    }));
    const classifier = buildClassifierMock({
      agentType: AgentType.CODE_REVIEWER,
      confidence: 0.8,
      reason: 'PR 리뷰 요청',
    });
    const { usecase } = buildUsecase(
      [pmDispatcher, reviewerDispatcher],
      classifier,
    );

    const result = await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '김기획과 박꼼꼼에게 같이 맡겨줘 owner/repo#42',
    });

    expect(classifier.classify).toHaveBeenCalled();
    expect(result.workerType).toBe(AgentType.CODE_REVIEWER);
  });

  it('자연어 분류 시 classifier 의 userInstruction + 직전 runId 를 conversationContext 로 dispatcher 에 전달', async () => {
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 50,
      output: {},
      modelUsed: 'mock',
    }));
    const classifier = buildClassifierMock({
      agentType: AgentType.PM,
      confidence: 0.9,
      reason: '직전 대화 follow-up',
      userInstruction: '직전 논의한 개선 항목 우선순위화',
    });
    const { usecase } = buildUsecase([pmDispatcher], classifier);

    await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '네 정리해주세요',
      contextRefs: { agentRunId: 7 },
    });

    expect(pmDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTypeHint: AgentType.PM,
        conversationContext: {
          userInstruction: '직전 논의한 개선 항목 우선순위화',
          priorAgentRunId: 7,
        },
      }),
    );
  });

  it('replyContext(비동기 회신 컨텍스트)를 dispatcher 로 통과시킨다', async () => {
    const blogDispatcher = buildDispatcher(AgentType.BLOG, () => ({
      agentRunId: 0,
      output: { async: true },
      modelUsed: 'hermes-cli',
    }));
    const { usecase } = buildUsecase([blogDispatcher]);
    const replyContext = { channel: 'C1', threadTs: '1730000000.0001' };

    await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      agentTypeHint: AgentType.BLOG,
      replyContext,
    });

    expect(blogDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ replyContext }),
    );
  });

  it('agentTypeHint(슬래시) 경로는 userInstruction 없이 conversationContext 전달 (priorAgentRunId 만, 있으면)', async () => {
    const pmDispatcher = buildDispatcher(AgentType.PM, () => ({
      agentRunId: 60,
      output: {},
      modelUsed: 'mock',
    }));
    const { usecase, classifier } = buildUsecase([pmDispatcher]);

    await usecase.dispatch({
      source: 'SLACK_COMMAND',
      slackUserId: 'U1',
      agentTypeHint: AgentType.PM,
      text: 'plan today',
    });

    expect(classifier.classify).not.toHaveBeenCalled();
    const callArg = (pmDispatcher.dispatch as jest.Mock).mock.calls[0][0];
    expect(callArg.conversationContext?.userInstruction).toBeUndefined();
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
          toWorker: AgentType.CODE_REVIEWER,
          reason: 'PM 이 BE 검토 요청',
          passthroughInput: { text: 'user repository 만들어줘' },
        },
      }));
      const beDispatcher = buildDispatcher(AgentType.CODE_REVIEWER, () => ({
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

      // step 6 + #5 갱신 — root return 은 chain 의 first worker (PM) 결과, handoffResults 에 BE 누적.
      expect(result.agentRunId).toBe(1);
      expect(result.workerType).toBe(AgentType.PM);
      expect(result.output).toEqual({ plan: 'PM result' });
      expect(result.handoffResults).toHaveLength(1);
      expect(result.handoffResults?.[0]).toMatchObject({
        agentRunId: 2,
        workerType: AgentType.CODE_REVIEWER,
        output: { plan: 'BE result' },
      });
      // nested 의 handoffResults 는 root 가 평탄화 → leaf 는 자기 자신 외 child 정보 없음.
      expect(result.handoffResults?.[0].handoffResults).toBeUndefined();

      // BE dispatcher 가 passthroughInput.text 와 parent contextRefs 로 호출됐는지.
      expect(beDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'SLACK_COMMAND',
          agentTypeHint: AgentType.CODE_REVIEWER,
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
          toWorker: AgentType.CODE_REVIEWER,
          reason: 'PM → BE',
          passthroughInput: {},
        },
      }));
      const beDispatcher = buildDispatcher(AgentType.CODE_REVIEWER, () => ({
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
          toWorker: AgentType.PO_SHADOW,
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

  describe('라우팅 근거를 dispatch 스코프에 싣는다', () => {
    const PM_RUN_ID = 55;

    // 워커가 자기 AgentRun 을 여는 시점에 무엇을 보게 되는지를 본다. 라우터가 dispatch 를
    // 끝낸 뒤 되돌아가 붙이는 방식이었다면 워커가 예외로 끝나는 순간 이 값이 사라졌다.
    const buildSpyDispatcher = (
      agentType: AgentType,
      outcomeFn: (input: DispatchInput) => Partial<DispatchOutcome>,
    ): {
      dispatcher: AgentDispatcher;
      seen: () => RoutingContext | undefined;
    } => {
      let captured: RoutingContext | undefined;
      const dispatcher: AgentDispatcher = {
        agentType,
        dispatch: jest.fn(async (input: DispatchInput) => {
          captured = claimRoutingContext();
          return {
            output: {},
            modelUsed: 'mock-model',
            formattedText: `mock formatted text for ${agentType}`,
            ...outcomeFn(input),
          } as DispatchOutcome;
        }),
      };
      return { dispatcher, seen: () => captured };
    };

    it('분류기를 탄 경로는 원문·대상·확신도를 classifier 로 싣는다', async () => {
      const { dispatcher, seen } = buildSpyDispatcher(AgentType.PM, () => ({
        agentRunId: PM_RUN_ID,
      }));
      const classifier = buildClassifierMock({
        agentType: AgentType.PM,
        confidence: 0.93,
        reason: '계획 수립 요청',
      });
      const { usecase } = buildUsecase([dispatcher], classifier);

      await usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '내일 뭐부터 하지?',
      });

      expect(seen()).toEqual({
        text: '내일 뭐부터 하지?',
        routedTo: AgentType.PM,
        routedVia: 'classifier',
        confidence: 0.93,
      });
    });

    // 슬래시는 분류기를 타지 않는다. confidence 를 실으면 분류기가 낸 값처럼 보여 채점이 오염된다.
    it('슬래시(agentTypeHint) 경로는 hint 로 싣고 confidence 를 싣지 않는다', async () => {
      const { dispatcher, seen } = buildSpyDispatcher(AgentType.PM, () => ({
        agentRunId: PM_RUN_ID,
      }));
      const { usecase } = buildUsecase([dispatcher]);

      await usecase.dispatch({
        source: 'SLACK_COMMAND',
        slackUserId: 'U1',
        text: '오늘 할 일',
        agentTypeHint: AgentType.PM,
      });

      expect(seen()).toEqual({
        text: '오늘 할 일',
        routedTo: AgentType.PM,
        routedVia: 'hint',
      });
    });

    it('text 가 없으면 스코프를 열지 않는다 — 채점할 원문이 없다', async () => {
      const { dispatcher, seen } = buildSpyDispatcher(AgentType.PM, () => ({
        agentRunId: PM_RUN_ID,
      }));
      const { usecase } = buildUsecase([dispatcher]);

      await usecase.dispatch({
        source: 'SLACK_COMMAND',
        slackUserId: 'U1',
        agentTypeHint: AgentType.PM,
      });

      expect(seen()).toBeUndefined();
    });

    // 이 수리의 핵심 — 예전에는 dispatch 가 반환해야만 기록이 붙어서, 분류가 틀려 워커가 죽은
    // 회차(정확도 분석에 가장 필요한 표본)가 통째로 빠졌다.
    it('워커가 예외로 끝나도 근거는 이미 스코프 안에서 전달돼 있다', async () => {
      let captured: RoutingContext | undefined;
      const dispatcher: AgentDispatcher = {
        agentType: AgentType.PM,
        dispatch: jest.fn(async () => {
          captured = claimRoutingContext();
          throw new Error('워커가 입력을 거절했다');
        }),
      };
      const { usecase } = buildUsecase([dispatcher]);

      await expect(
        usecase.dispatch({
          source: 'SLACK_MESSAGE',
          slackUserId: 'U1',
          text: 'PR 리뷰 좀',
          agentTypeHint: AgentType.PM,
        }),
      ).rejects.toThrow('워커가 입력을 거절했다');

      expect(captured).toEqual({
        text: 'PR 리뷰 좀',
        routedTo: AgentType.PM,
        routedVia: 'hint',
      });
    });

    // BLOG 는 즉시 ack 하고 실제 실행을 `void` 로 띄운다. 예전 방식(outcome.agentRunId 로
    // 되돌아가 붙이기)에서는 sentinel 0 이 반환돼 **성공해도** 기록되지 않았다.
    it('dispatch 가 반환한 뒤 도는 백그라운드 실행도 같은 근거를 본다', async () => {
      let backgroundSeen: RoutingContext | undefined;
      let settleBackground: (() => void) | undefined;
      const background = new Promise<void>((resolve) => {
        settleBackground = resolve;
      });
      const dispatcher: AgentDispatcher = {
        agentType: AgentType.BLOG,
        dispatch: jest.fn(async () => {
          void (async () => {
            await Promise.resolve();
            backgroundSeen = claimRoutingContext();
            settleBackground?.();
          })();
          return {
            agentRunId: 0,
            output: {},
            modelUsed: 'mock-model',
            formattedText: 'ack',
          } as DispatchOutcome;
        }),
      };
      const { usecase } = buildUsecase([dispatcher]);

      await usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '블로그 초안 써줘',
        agentTypeHint: AgentType.BLOG,
      });
      await background;

      expect(backgroundSeen).toEqual({
        text: '블로그 초안 써줘',
        routedTo: AgentType.BLOG,
        routedVia: 'hint',
      });
    });

    // 스코프당 한 번만 — 한 dispatch 가 run 을 둘 열면 같은 발화가 여러 행에 복사돼
    // 분류 정확도의 분모가 부풀어 오른다.
    it('한 스코프에서 두 번째로 집으려 하면 빈손이다', async () => {
      const captured: (RoutingContext | undefined)[] = [];
      const dispatcher: AgentDispatcher = {
        agentType: AgentType.PM,
        dispatch: jest.fn(async () => {
          captured.push(claimRoutingContext(), claimRoutingContext());
          return {
            agentRunId: PM_RUN_ID,
            output: {},
            modelUsed: 'mock-model',
            formattedText: 'ok',
          } as DispatchOutcome;
        }),
      };
      const { usecase } = buildUsecase([dispatcher]);

      await usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '오늘 뭐해',
        agentTypeHint: AgentType.PM,
      });

      expect(captured[0]).toBeDefined();
      expect(captured[1]).toBeUndefined();
    });

    it('handoff chain 의 자식은 자기 원문으로 새 스코프를 연다', async () => {
      const { dispatcher: parent } = buildSpyDispatcher(AgentType.PM, () => ({
        agentRunId: PM_RUN_ID,
        followUp: {
          toWorker: AgentType.WORK_REVIEWER,
          reason: '후속 정리',
          passthroughInput: { text: '오늘 한 일 정리해줘' },
        },
      }));
      const { dispatcher: child, seen: childSeen } = buildSpyDispatcher(
        AgentType.WORK_REVIEWER,
        () => ({ agentRunId: 56 }),
      );
      const { usecase } = buildUsecase([parent, child]);

      await usecase.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text: '내일 뭐부터 하지?',
        agentTypeHint: AgentType.PM,
      });

      expect(childSeen()).toEqual({
        text: '오늘 한 일 정리해줘',
        routedTo: AgentType.WORK_REVIEWER,
        routedVia: 'hint',
      });
    });
  });

  // 과거 실행 id 를 돌려주는 경로(CAREER_MATE 의 RENDER_*)에 이번 chain 의 부모를 적으면
  // 그 행이 다른 요청의 자식으로 둔갑한다.
  it('재사용된 run 에는 parentId 를 쓰지 않는다', async () => {
    const dispatcher = buildDispatcher(AgentType.CAREER_MATE, () => ({
      agentRunId: 31,
      reusedAgentRun: true,
    }));
    const { usecase, agentRunService } = buildUsecase([dispatcher]);

    await usecase.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '이력서 렌더해줘',
      agentTypeHint: AgentType.CAREER_MATE,
      contextRefs: { agentRunId: 12 },
    });

    expect(agentRunService.setParentId).not.toHaveBeenCalled();
  });

  // 이 세 갈래는 워커를 한 번도 부르지 않아 AgentRun 이 아예 없었다 — 분류가 실패한 표본이
  // 원장에 0건이었다는 뜻이고, 정확도를 재려는 쪽에서 가장 필요한 회차가 빠진 것이다.
  describe('담당자를 고르지 못한 요청도 원장에 남긴다', () => {
    it('분류기가 UNKNOWN 이면 ROUTER 이름으로 실패 행을 남긴다', async () => {
      const classifier = buildClassifierMock({
        agentType: 'UNKNOWN',
        confidence: 0,
        reason: '의도 불명',
      });
      const { usecase, agentRunService } = buildUsecase([], classifier);

      await expect(
        usecase.dispatch({
          source: 'SLACK_MESSAGE',
          slackUserId: 'U1',
          text: '음 그거 있잖아',
        }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      });

      expect(agentRunService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: AgentType.ROUTER,
          triggerType: TriggerType.ROUTING_FAILED,
        }),
      );
    });

    // 없는 담당자 이름을 지어내면 나중에 "그 워커로 보냈다" 와 구분되지 않는다.
    it('UNKNOWN 회차의 routedTo 는 분류기 어휘 그대로 UNKNOWN 이다', async () => {
      let seen: RoutingContext | undefined;
      const classifier = buildClassifierMock({
        agentType: 'UNKNOWN',
        confidence: 0,
        reason: '의도 불명',
      });
      const agentRunService = {
        setParentId: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn(async ({ run }: { run: () => unknown }) => {
          seen = claimRoutingContext();
          await run();
        }),
      } as unknown as jest.Mocked<AgentRunService>;
      const { usecase } = buildUsecase([], classifier, agentRunService);

      await expect(
        usecase.dispatch({
          source: 'SLACK_MESSAGE',
          slackUserId: 'U1',
          text: '음 그거 있잖아',
        }),
      ).rejects.toBeDefined();

      expect(seen).toEqual({
        text: '음 그거 있잖아',
        routedTo: 'UNKNOWN',
        routedVia: 'classifier',
        // 0 으로 고정된 계약이 아니다 — 실어야 "낮은 확신으로 포기" 와 "높은데도 못 고름" 이 갈린다.
        confidence: 0,
      });
    });

    // 분류기 파서는 AgentType 전체를 허용하므로 dispatcher 없는 워커가 나올 수 있다.
    // 그건 명백한 오분류 표본이라 고른 대상까지 남겨야 한다.
    it('미등록 담당자를 골랐으면 그 이름을 routedTo 로 남긴다', async () => {
      let seen: RoutingContext | undefined;
      const agentRunService = {
        setParentId: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn(async ({ run }: { run: () => unknown }) => {
          seen = claimRoutingContext();
          await run();
        }),
      } as unknown as jest.Mocked<AgentRunService>;
      const { usecase } = buildUsecase([], undefined, agentRunService);

      await expect(
        usecase.dispatch({
          source: 'SLACK_MESSAGE',
          slackUserId: 'U1',
          text: '오늘 할 일',
          agentTypeHint: AgentType.PM,
        }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
      });

      expect(seen).toEqual({
        text: '오늘 할 일',
        routedTo: AgentType.PM,
        routedVia: 'hint',
      });
    });

    // 원문도 hint 도 없는 요청은 아예 남기지 않는다. 채점할 문장이 없어 표본 가치가 0 이고
    // 분류기를 타지도 않았다 — 남겨 봐야 무엇을 잘못 분류했는지 되짚을 수 없다.
    it('text 도 hint 도 없으면 원장에 남기지 않는다', async () => {
      const agentRunService = {
        setParentId: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn(),
      } as unknown as jest.Mocked<AgentRunService>;
      const { usecase } = buildUsecase([], undefined, agentRunService);

      await expect(
        usecase.dispatch({ source: 'SLACK_MESSAGE', slackUserId: 'U1' }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.INTENT_HINT_REQUIRED,
      });

      expect(agentRunService.execute).not.toHaveBeenCalled();
    });

    // 이 PR 의 P1 수정 — 분류기 UNKNOWN 은 운영 실패가 아니다. 시스템은 그걸 잡담으로 보고
    // ConversationalReply 로 정상 응답한다. FAILED 로 적으면 인사 한 마디가 24시간 동안
    // 지연 보고에 "ROUTER 실행 실패" 로 뜬다 — findFailedRunsSince 는 status·endedAt 만 본다.
    it('UNKNOWN 은 정상 종료로 남긴다 — 잡담이 실패 집계를 오염시키면 안 된다', async () => {
      const classifier = buildClassifierMock({
        agentType: 'UNKNOWN',
        confidence: 0.2,
        reason: '인사말',
      });
      let ranWithoutThrowing = false;
      const agentRunService = {
        setParentId: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn(async ({ run }: { run: () => Promise<unknown> }) => {
          // execute 는 run 이 정상 반환하면 SUCCEEDED, 던지면 FAILED 로 마감한다.
          await run();
          ranWithoutThrowing = true;
        }),
      } as unknown as jest.Mocked<AgentRunService>;
      const { usecase } = buildUsecase([], classifier, agentRunService);

      await expect(
        usecase.dispatch({
          source: 'SLACK_MESSAGE',
          slackUserId: 'U1',
          text: '안녕하세요',
        }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      });

      expect(ranWithoutThrowing).toBe(true);
    });

    // 반대쪽 — 미등록 dispatcher 는 진짜 결함이다. 그 워커로 가야 할 요청이 전부 막히므로
    // 실패로 남아 지연 보고에 떠야 한다.
    it('미등록 담당자는 실패로 남긴다', async () => {
      let runRejected = false;
      const agentRunService = {
        setParentId: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn(async ({ run }: { run: () => Promise<unknown> }) => {
          await run().catch(() => {
            runRejected = true;
          });
        }),
      } as unknown as jest.Mocked<AgentRunService>;
      const { usecase } = buildUsecase([], undefined, agentRunService);

      await expect(
        usecase.dispatch({
          source: 'SLACK_MESSAGE',
          slackUserId: 'U1',
          text: '오늘 할 일',
          agentTypeHint: AgentType.PM,
        }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
      });

      expect(runRejected).toBe(true);
    });

    // 기록은 부수 효과다 — 원장이 죽었다고 사용자에게 다른 오류를 보이면 안 된다.
    it('기록이 실패해도 사용자에게는 원래 라우팅 오류가 간다', async () => {
      const agentRunService = {
        setParentId: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn().mockRejectedValue(new Error('DB 연결 끊김')),
      } as unknown as jest.Mocked<AgentRunService>;
      const { usecase } = buildUsecase([], undefined, agentRunService);

      await expect(
        usecase.dispatch({
          source: 'SLACK_MESSAGE',
          slackUserId: 'U1',
          text: '오늘 할 일',
          agentTypeHint: AgentType.PM,
        }),
      ).rejects.toMatchObject({
        routerErrorCode: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
      });
    });
  });
});
