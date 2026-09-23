import { Inject, Injectable, Logger } from '@nestjs/common';

import { resolveAgentTypeByNickname } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import {
  RoutingContext,
  runWithRoutingContext,
} from '../../agent-run/application/routing-context';
import { RoutedVia, TriggerType } from '../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationContext } from '../domain/conversation-context.type';
import {
  DispatchInput,
  DispatchResult,
  IdaeriRouterPort,
} from '../domain/idaeri-router.port';
import {
  AGENT_DISPATCHER_PORT,
  AgentDispatcher,
  DispatchOutcome,
} from '../domain/port/agent-dispatcher.port';
import { RouterException } from '../domain/router.exception';
import { RouterErrorCode } from '../domain/router-error-code.enum';
import { IntentClassifierUsecase } from './intent-classifier.usecase';

// Hierarchical Manager Pattern (이대리 비전 봇 쪼개기) 의 manager-agent.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4)
//
// step 6 — handoff chain 처리. worker 의 DispatchOutcome.followUp 가 채워지면 manager 가
// cycle (같은 worker 재진입) / depth (≤ MAX_HANDOFF_DEPTH) 가드 후 재 dispatch.
// 최종 반환은 chain 마지막 worker 의 결과 — 중간 worker 결과는 logger 로만 추적
// (DispatchResult 의 handoffResults 필드 확장은 follow-up plan 에서 검토).
const MAX_HANDOFF_DEPTH = 3;

interface HandoffChainState {
  depth: number;
  visited: AgentType[];
}

@Injectable()
export class IdaeriRouterUsecase implements IdaeriRouterPort {
  private readonly logger = new Logger(IdaeriRouterUsecase.name);
  private readonly dispatcherByType: Map<AgentType, AgentDispatcher>;

  constructor(
    @Inject(AGENT_DISPATCHER_PORT)
    private readonly dispatchers: AgentDispatcher[],
    private readonly intentClassifier: IntentClassifierUsecase,
    private readonly agentRunService: AgentRunService,
  ) {
    // 회귀 방지 안전망 (commit cbef813 의 root cause 재발 차단) — NestJS 의 multi-provider 가
    // module 경계를 넘어 합쳐지지 않아 dispatchers 가 single 객체로 inject 된 경우 즉시 명시 에러.
    // 정상 동작은 RouterModule 의 중앙 useFactory + inject 패턴에서 array 가 보장된다.
    if (!Array.isArray(this.dispatchers)) {
      throw new RouterException({
        code: RouterErrorCode.DISPATCHER_REGISTRY_INVALID,
        message: `AGENT_DISPATCHER_PORT 가 array 가 아닙니다 (typeof=${typeof this.dispatchers}). RouterModule 의 useFactory + inject 등록을 확인하세요.`,
        status: DomainStatus.INTERNAL,
      });
    }
    this.dispatcherByType = new Map(
      this.dispatchers.map((dispatcher) => [dispatcher.agentType, dispatcher]),
    );
    this.logger.log(
      `Router dispatcher registry — ${this.dispatcherByType.size}개 worker 등록: ${[...this.dispatcherByType.keys()].join(', ') || '(없음)'}`,
    );
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    return this.dispatchInternal(input, { depth: 0, visited: [] });
  }

  private async dispatchInternal(
    input: DispatchInput,
    chain: HandoffChainState,
  ): Promise<DispatchResult> {
    // 자연어 진입(agentTypeHint 없음)이면 classify 로 agentType + userInstruction 추출.
    // 슬래시(agentTypeHint 있음)는 classify 우회 — userInstruction 없음.
    const nicknameAgentType = input.text
      ? resolveAgentTypeByNickname(input.text, this.dispatcherByType.keys())
      : undefined;
    // routedVia 는 원장에 그대로 실린다 — 분류기를 탄 회차만 골라 채점하려면 셋을 구분해야 한다.
    const classified: {
      agentType: AgentType;
      userInstruction?: string | undefined;
      routedVia: RoutedVia;
      confidence?: number;
    } = input.agentTypeHint
      ? {
          agentType: input.agentTypeHint,
          userInstruction: undefined,
          routedVia: 'hint',
        }
      : nicknameAgentType
        ? {
            agentType: nicknameAgentType,
            userInstruction: undefined,
            routedVia: 'nickname',
          }
        : { ...(await this.classifyOrThrow(input)), routedVia: 'classifier' };
    const agentType = classified.agentType;

    const dispatcher = this.dispatcherByType.get(agentType);
    if (!dispatcher) {
      this.logger.warn(
        `Router dispatch — agentType=${agentType} 미등록 dispatcher (등록된 worker: ${[...this.dispatcherByType.keys()].join(', ') || '(없음)'}).`,
      );
      // 분류기가 dispatcher 없는 워커를 골랐을 수 있다(파서가 AgentType 전체를 허용한다).
      // 그건 명백한 오분류 표본이라 원장에 남긴다 — 고른 대상까지 함께.
      return this.failRouting(
        new RouterException({
          code: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
          message: `Router 가 agentType=${agentType} dispatcher 를 알지 못합니다. 해당 agent module 이 AGENT_DISPATCHER_PORT 에 등록됐는지 확인하세요.`,
          status: DomainStatus.BAD_REQUEST,
        }),
        input,
        { routedTo: agentType, routedVia: classified.routedVia },
      );
    }

    // 대화 맥락을 워커 실행 입력까지 전달 — classifier 가 추출한 사용자 지시(userInstruction)
    // + 직전 worker run id(contextRefs.agentRunId). 외부에서 conversationContext 를 직접
    // 주입한 경우는 그 위에 router 추출분을 덮어쓰지 않고 보존(외부 우선).
    const conversationContext: ConversationContext = {
      ...(classified.userInstruction !== undefined
        ? { userInstruction: classified.userInstruction }
        : {}),
      ...(input.contextRefs?.agentRunId !== undefined
        ? { priorAgentRunId: input.contextRefs.agentRunId }
        : {}),
      ...input.conversationContext,
    };
    // 라우팅 근거를 dispatch 를 감싼 스코프에 놓아 둔다 — 이 아래에서 열리는 **첫 AgentRun**
    // 이 그걸 집어 자기 inputSnapshot 에 담는다(AgentRunService.execute).
    //
    // 예전에는 dispatch 가 끝난 뒤 outcome.agentRunId 로 되돌아가 붙였는데, 워커가 예외로
    // 끝나면 그 되받기가 통째로 끊겼다 — 하필 **분류가 틀려서 죽은 회차**, 즉 정확도 분석에
    // 가장 필요한 표본이 빠졌다. 행은 예외보다 먼저 만들어지므로 여기서 미리 넘기면 성공·실패를
    // 가리지 않는다. `void` 로 띄우는 비동기 워커(BLOG)도 스코프를 물려받아 같이 해결된다
    // (그쪽은 agentRunId 0 sentinel 을 반환해 예전 방식으로는 성공해도 기록되지 않았다).
    //
    // 과거 실행 id 를 재사용하는 경로(CAREER_MATE 의 RENDER_*)는 새 행을 열지 않으므로
    // 이 근거가 그 행에 닿을 길이 없다 — 라우팅 근거 쪽은 구조적으로 안전해졌다.
    // (parentId 쪽은 여전히 outcome.agentRunId 를 직접 쓰므로 아래에서 따로 막는다.)
    //
    // 원문이 없으면(handoff passthrough 가 비는 경우) 채점할 것이 없으니 근거도 두지 않는다 —
    // #629 의 `if (input.text && …)` 가드를 그대로 승계한다.
    const routing: RoutingContext | undefined = input.text
      ? {
          text: input.text,
          routedTo: agentType,
          routedVia: classified.routedVia,
          ...(classified.confidence !== undefined
            ? { confidence: classified.confidence }
            : {}),
        }
      : undefined;
    // input.replyContext(비동기 회신 컨텍스트)는 `...input` spread 로 root dispatch 에만
    // 통과된다 — 비동기 worker(BLOG)가 백그라운드 완료 후 같은 스레드에 답장하는 데 쓴다.
    // handoff chain 자식(followUpInput)에는 의도적으로 미전달(아래 followUpInput 구성부 참조).
    const runDispatch = (): Promise<DispatchOutcome> =>
      dispatcher.dispatch({
        ...input,
        agentTypeHint: agentType,
        conversationContext,
      });
    const outcome =
      routing === undefined
        ? await runDispatch()
        : await runWithRoutingContext(routing, runDispatch);
    this.logger.log(
      `Router dispatch 완료 — agentType=${agentType} agentRunId=${outcome.agentRunId} model=${outcome.modelUsed} depth=${chain.depth}`,
    );

    // step 8 — handoff chain audit log. parent.id 가 input.contextRefs 에 실려오면 child run 의
    // parentId 컬럼에 기록. 실패는 audit 누락에 그치므로 chain 진행 자체를 멈추지 않는다.
    const parentAgentRunId = input.contextRefs?.agentRunId;
    // agentRunId 0 은 "유효 run 없음" sentinel (deterministic/UNKNOWN 분기) — setParentId(id:0) 가
    // Prisma P2025 를 던지므로 가드한다 (career-mate UNKNOWN · vacation LIST 등 공통).
    // reusedAgentRun 이 서면 그 id 는 **과거 실행**의 것이다 — 이번 chain 의 부모를 적어 넣으면
    // 그 행이 다른 요청의 자식으로 둔갑한다 (#629 가 라우팅 근거 쪽에만 걸어 둔 가드를 이쪽에도 건다).
    if (
      parentAgentRunId !== undefined &&
      outcome.agentRunId > 0 &&
      !outcome.reusedAgentRun
    ) {
      try {
        await this.agentRunService.setParentId({
          id: outcome.agentRunId,
          parentId: parentAgentRunId,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Router parentId 기록 실패 — childRunId=${outcome.agentRunId} parentRunId=${parentAgentRunId}: ${message}`,
        );
      }
    }

    const currentResult: DispatchResult = {
      agentRunId: outcome.agentRunId,
      workerType: agentType,
      output: outcome.output,
      modelUsed: outcome.modelUsed,
      formattedText: outcome.formattedText,
      ...(outcome.autoResolvedNotice !== undefined
        ? { autoResolvedNotice: outcome.autoResolvedNotice }
        : {}),
      ...(outcome.slackBlocks !== undefined
        ? { slackBlocks: outcome.slackBlocks }
        : {}),
      ...(outcome.preview !== undefined ? { preview: outcome.preview } : {}),
      followUp: outcome.followUp,
    };

    if (!outcome.followUp) {
      return currentResult;
    }

    const nextWorker = outcome.followUp.toWorker;
    const nextChain: HandoffChainState = {
      depth: chain.depth + 1,
      visited: [...chain.visited, agentType],
    };
    if (nextChain.depth > MAX_HANDOFF_DEPTH) {
      throw new RouterException({
        code: RouterErrorCode.DEPTH_EXCEEDED,
        message: `Handoff chain 깊이 ${MAX_HANDOFF_DEPTH} 초과: ${nextChain.visited.join(' → ')} → ${nextWorker}`,
        status: DomainStatus.BAD_REQUEST,
      });
    }
    if (nextChain.visited.includes(nextWorker)) {
      throw new RouterException({
        code: RouterErrorCode.CYCLE_DETECTED,
        message: `Handoff chain 안 ${nextWorker} 재진입 — cycle (${nextChain.visited.join(' → ')} → ${nextWorker})`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    this.logger.log(
      `Router handoff — ${agentType} → ${nextWorker} (depth=${nextChain.depth}, reason="${outcome.followUp.reason}")`,
    );

    const followUpInput: DispatchInput = {
      source: input.source,
      slackUserId: input.slackUserId,
      agentTypeHint: nextWorker,
      text: extractPassthroughText(outcome.followUp.passthroughInput),
      contextRefs: { agentRunId: outcome.agentRunId },
    };
    const nestedResult = await this.dispatchInternal(followUpInput, nextChain);

    // chain 전체를 root 의 handoffResults 에 평탄화 — nested 의 handoffResults 는 그대로 합쳐
    // root 가 chain 시퀀스 전체를 알게 된다 (Slack handler 가 footer / 결합 본문 작성에 활용).
    return {
      ...currentResult,
      handoffResults: [
        toLeafResult(nestedResult),
        ...(nestedResult.handoffResults ?? []),
      ],
    };
  }

  /**
   * 담당자를 고르지 못해 dispatch 이전에 끊긴 요청을 원장에 남기고, 원래 예외를 그대로 던진다.
   *
   * 이 세 갈래(분류 실패·미등록 담당자·입력 없음)는 워커를 한 번도 부르지 않으므로 AgentRun
   * 이 아예 만들어지지 않았다. 그래서 **분류가 실패한 표본이 원장에 0건**이었다 — 정확도를
   * 재려는 쪽에서 가장 필요한 회차가 통째로 빠진 것이다. 여기서 `AgentType.ROUTER` 로 한 줄을
   * 남긴다(라우터는 워커가 아니라 설비이고, 고르지 못한 회차만 자기 이름으로 기록한다).
   *
   * 기록은 부수 효과다 — 실패해도 사용자에게 돌려줄 오류는 원래 예외 그대로다. `execute` 가
   * 되던지는 것은 우리가 넘긴 그 예외이므로 삼키고, 그 외(DB 장애 등)만 로그로 남긴다.
   *
   * `run` 이 곧바로 거절하므로 이 실행은 반드시 FAILED 로 마감되고, `execute` 의 실패 경로가
   * errorCode 와 failureKind 를 함께 적는다 — 기록 형식을 여기서 따로 만들지 않는다.
   */
  private async failRouting(
    exception: RouterException,
    input: DispatchInput,
    attempted: { routedTo: string; routedVia: RoutedVia } | undefined,
  ): Promise<never> {
    const recordFailure = (): Promise<unknown> =>
      this.agentRunService.execute({
        agentType: AgentType.ROUTER,
        triggerType: TriggerType.ROUTING_FAILED,
        inputSnapshot: {
          source: input.source,
          slackUserId: input.slackUserId,
        },
        run: () => Promise.reject(exception),
      });
    try {
      // 원문이 없는 갈래(INTENT_HINT_REQUIRED)는 채점할 것이 없어 근거를 두지 않는다 —
      // 그 경우에도 행은 남으므로 "왜 끊겼는지" 는 errorCode 로 읽을 수 있다.
      await (input.text && attempted !== undefined
        ? runWithRoutingContext(
            { text: input.text, ...attempted },
            recordFailure,
          )
        : recordFailure());
    } catch (error: unknown) {
      if (error !== exception) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Router 라우팅 실패 기록 실패 — ${message}`);
      }
    }
    throw exception;
  }

  // agentTypeHint 가 없을 때만 호출된다. text 도 없으면 분류 불가 → INTENT_HINT_REQUIRED.
  // classifier 가 UNKNOWN 반환 시 INTENT_CLASSIFY_FAILED — 사용자에게 의도 모호 안내.
  // agentType 뿐 아니라 userInstruction(직전 대화 기반 사용자 지시)도 함께 반환 — 워커 전달용.
  private async classifyOrThrow(input: DispatchInput): Promise<{
    agentType: AgentType;
    userInstruction?: string;
    confidence: number;
  }> {
    const text = input.text?.trim() ?? '';
    if (text.length === 0) {
      this.logger.warn(
        `Router dispatch — agentTypeHint 누락 + text 비어 있음 (source=${input.source}, user=${input.slackUserId}).`,
      );
      return this.failRouting(
        new RouterException({
          code: RouterErrorCode.INTENT_HINT_REQUIRED,
          message:
            'agentTypeHint 도 자연어 text 도 없어 intent 분류가 불가합니다.',
          status: DomainStatus.BAD_REQUEST,
        }),
        input,
        undefined,
      );
    }

    const classification = await this.intentClassifier.classify(
      text,
      input.priorTurns,
    );
    if (classification.agentType === 'UNKNOWN') {
      this.logger.warn(
        `Router intent classifier UNKNOWN — text="${text.slice(0, 60)}" reason="${classification.reason}"`,
      );
      // 분류기가 아무도 고르지 못한 회차 — 정확도 분석에 가장 값진 표본이다.
      // routedTo 는 분류기 자신의 어휘를 그대로 쓴다('UNKNOWN'). 없는 담당자 이름을
      // 지어내면 나중에 "그 워커로 보냈다" 와 구분되지 않는다.
      return this.failRouting(
        new RouterException({
          code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
          message: `사용자 의도를 10개 worker 중 하나로 분류하지 못했습니다. reason: ${classification.reason || '(없음)'}`,
          status: DomainStatus.BAD_REQUEST,
        }),
        input,
        { routedTo: 'UNKNOWN', routedVia: 'classifier' },
      );
    }
    return {
      agentType: classification.agentType,
      userInstruction: classification.userInstruction,
      confidence: classification.confidence,
    };
  }
}

// HandoffSpec.passthroughInput 안 'text' 필드를 표준 키로 인정 — 다음 worker 가 text 로 받는다.
// 다른 키가 필요한 경우는 follow-up plan 의 typed Handoff 도입 시 분기.
const extractPassthroughText = (
  passthroughInput: Record<string, unknown>,
): string => {
  const text = passthroughInput.text;
  return typeof text === 'string' ? text : '';
};

// chain 평탄화 helper — nested 의 handoffResults 는 root 가 따로 누적하므로 leaf 만 노출.
// 중첩 chain 시 root 의 handoffResults 가 모든 worker 를 평탄 시퀀스로 가지게 한다.
const toLeafResult = (result: DispatchResult): DispatchResult => {
  const { handoffResults: _omit, ...leaf } = result;
  void _omit;
  return leaf;
};
