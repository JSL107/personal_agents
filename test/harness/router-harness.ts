/**
 * Router 로컬 스모크 하네스.
 *
 * 실 Slack / LLM CLI / DB / Redis 없이 `IdaeriRouterUsecase`(실제 클래스) + 분류 결과 +
 * 전 AgentType mock dispatcher 를 in-process 로 조립해, "텍스트/agentTypeHint → 라우팅 →
 * dispatch 결과" 를 재생한다.
 *
 * 한계(설계서 §3 참조): 모든 dispatcher 가 mock 이므로 라우터/IntentClassifier 호출/dispatch
 * 배선·핸드오프 체인을 검증할 뿐, 실 에이전트 로직(GitHub/Notion 호출 등)은 검증하지 않는다.
 * 실 에이전트 로직은 기존 단위 spec 이 담당. 이 하네스의 가치 = 라우터 배선 회귀의 빠른 스모크.
 *
 * jest 에 의존하지 않는다 — CLI(scripts/harness-replay.ts)도 ts-node 로 같은 빌더를 쓴다.
 */

import { AgentRunService } from '../../src/agent-run/application/agent-run.service';
import { AgentType } from '../../src/model-router/domain/model-router.type';
import { IdaeriRouterUsecase } from '../../src/router/application/idaeri-router.usecase';
import { IntentClassifierUsecase } from '../../src/router/application/intent-classifier.usecase';
import {
  DispatchInput,
  DispatchResult,
} from '../../src/router/domain/idaeri-router.port';
import { IntentClassification } from '../../src/router/domain/intent-classification.type';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../src/router/domain/port/agent-dispatcher.port';

export type ClassifyFn = (
  text: string,
  priorTurns?: unknown,
) => IntentClassification | Promise<IntentClassification>;

/** dispatch 호출 기록(테스트 assertion 용). */
export interface DispatchCall {
  readonly agentType: AgentType;
  readonly input: DispatchInput;
}

export interface RouterHarness {
  readonly router: IdaeriRouterUsecase;
  /** 그동안 mock dispatcher 가 받은 dispatch 호출들. */
  readonly calls: DispatchCall[];
  /** text(자연어) 를 분류기로 라우팅. */
  replayText(text: string): Promise<DispatchResult>;
  /** agentType 을 직접 지정해 dispatch (분류기 우회). */
  replayHint(agentType: AgentType, text?: string): Promise<DispatchResult>;
}

export interface RouterHarnessOptions {
  /** 자연어 분류 동작. 기본은 keyword 휴리스틱(heuristicClassify). */
  classify?: ClassifyFn;
  /**
   * 특정 worker 에 followUp(핸드오프) 를 주입하고 싶을 때.
   * agentType → 그 dispatcher 가 반환할 DispatchOutcome 부분.
   */
  outcomeOverrides?: Partial<Record<AgentType, Partial<DispatchOutcome>>>;
}

let runIdSeq = 1000;

function buildMockDispatcher(
  agentType: AgentType,
  calls: DispatchCall[],
  override?: Partial<DispatchOutcome>,
): AgentDispatcher {
  return {
    agentType,
    dispatch: async (input: DispatchInput): Promise<DispatchOutcome> => {
      calls.push({ agentType, input });
      runIdSeq += 1;
      return {
        agentRunId: runIdSeq,
        output: { mock: true },
        modelUsed: `mock-${agentType}`,
        formattedText: `[MOCK ${agentType}] ${input.text ?? ''}`.trim(),
        ...override,
      };
    },
  };
}

/**
 * 오프라인 keyword 휴리스틱 분류기(하네스 전용 — 실 IntentClassifier LLM 분류 아님).
 * CLI 스모크에서 `--text` 를 결정론적으로 라우팅하기 위한 것.
 */
export const heuristicClassify: ClassifyFn = (text) => {
  const lowered = text.toLowerCase();
  const rules: ReadonlyArray<[RegExp, AgentType]> = [
    [/휴가|연차/u, AgentType.VACATION],
    [/스키마|schema/u, AgentType.BE_SCHEMA],
    [/테스트|test/u, AgentType.BE_TEST],
    [/리뷰|review|pr/u, AgentType.CODE_REVIEWER],
    [/분배|assign/u, AgentType.CTO],
    [/평가|eval/u, AgentType.PO_EVAL],
    [/회고|worklog|한 일/u, AgentType.WORK_REVIEWER],
    [/구현|백엔드|backend/u, AgentType.BE],
    [/오늘|plan|계획|할 일/u, AgentType.PM],
  ];
  const matched = rules.find(
    ([pattern]) => pattern.test(lowered) || pattern.test(text),
  );
  if (!matched) {
    return {
      agentType: 'UNKNOWN',
      confidence: 0,
      reason: '휴리스틱 매칭 실패',
    };
  }
  return {
    agentType: matched[1],
    confidence: 0.5,
    reason: `휴리스틱: ${matched[0]}`,
  };
};

function asClassifier(classify: ClassifyFn): IntentClassifierUsecase {
  return {
    classify: (text: string, priorTurns?: unknown) =>
      Promise.resolve(classify(text, priorTurns)),
  } as unknown as IntentClassifierUsecase;
}

function noopAgentRunService(): AgentRunService {
  return {
    setParentId: async () => undefined,
  } as unknown as AgentRunService;
}

export function buildRouterHarness(
  options: RouterHarnessOptions = {},
): RouterHarness {
  const calls: DispatchCall[] = [];
  const classify = options.classify ?? heuristicClassify;
  const dispatchers = Object.values(AgentType).map((agentType) =>
    buildMockDispatcher(
      agentType,
      calls,
      options.outcomeOverrides?.[agentType],
    ),
  );

  const router = new IdaeriRouterUsecase(
    dispatchers,
    asClassifier(classify),
    noopAgentRunService(),
  );

  return {
    router,
    calls,
    replayText: (text: string) =>
      router.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U_HARNESS',
        text,
      }),
    replayHint: (agentType: AgentType, text?: string) =>
      router.dispatch({
        source: 'SLACK_COMMAND',
        slackUserId: 'U_HARNESS',
        agentTypeHint: agentType,
        text,
      }),
  };
}
