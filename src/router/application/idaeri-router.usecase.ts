import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
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
    const classified = input.agentTypeHint
      ? { agentType: input.agentTypeHint, userInstruction: undefined }
      : await this.classifyOrThrow(input);
    const agentType = classified.agentType;

    const dispatcher = this.dispatcherByType.get(agentType);
    if (!dispatcher) {
      this.logger.warn(
        `Router dispatch — agentType=${agentType} 미등록 dispatcher (등록된 worker: ${[...this.dispatcherByType.keys()].join(', ') || '(없음)'}).`,
      );
      throw new RouterException({
        code: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
        message: `Router 가 agentType=${agentType} dispatcher 를 알지 못합니다. 해당 agent module 이 AGENT_DISPATCHER_PORT 에 등록됐는지 확인하세요.`,
        status: DomainStatus.BAD_REQUEST,
      });
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
    // input.replyContext(비동기 회신 컨텍스트)는 `...input` spread 로 root dispatch 에만
    // 통과된다 — 비동기 worker(BLOG)가 백그라운드 완료 후 같은 스레드에 답장하는 데 쓴다.
    // handoff chain 자식(followUpInput)에는 의도적으로 미전달(아래 followUpInput 구성부 참조).
    const outcome = await dispatcher.dispatch({
      ...input,
      agentTypeHint: agentType,
      conversationContext,
    });
    this.logger.log(
      `Router dispatch 완료 — agentType=${agentType} agentRunId=${outcome.agentRunId} model=${outcome.modelUsed} depth=${chain.depth}`,
    );

    // step 8 — handoff chain audit log. parent.id 가 input.contextRefs 에 실려오면 child run 의
    // parentId 컬럼에 기록. 실패는 audit 누락에 그치므로 chain 진행 자체를 멈추지 않는다.
    const parentAgentRunId = input.contextRefs?.agentRunId;
    // agentRunId 0 은 "유효 run 없음" sentinel (deterministic/UNKNOWN 분기) — setParentId(id:0) 가
    // Prisma P2025 를 던지므로 가드한다 (career-mate UNKNOWN · vacation LIST 등 공통).
    if (parentAgentRunId !== undefined && outcome.agentRunId > 0) {
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

  // agentTypeHint 가 없을 때만 호출된다. text 도 없으면 분류 불가 → INTENT_HINT_REQUIRED.
  // classifier 가 UNKNOWN 반환 시 INTENT_CLASSIFY_FAILED — 사용자에게 의도 모호 안내.
  // agentType 뿐 아니라 userInstruction(직전 대화 기반 사용자 지시)도 함께 반환 — 워커 전달용.
  private async classifyOrThrow(
    input: DispatchInput,
  ): Promise<{ agentType: AgentType; userInstruction?: string }> {
    const text = input.text?.trim() ?? '';
    if (text.length === 0) {
      this.logger.warn(
        `Router dispatch — agentTypeHint 누락 + text 비어 있음 (source=${input.source}, user=${input.slackUserId}).`,
      );
      throw new RouterException({
        code: RouterErrorCode.INTENT_HINT_REQUIRED,
        message:
          'agentTypeHint 도 자연어 text 도 없어 intent 분류가 불가합니다.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const classification = await this.intentClassifier.classify(
      text,
      input.priorTurns,
    );
    if (classification.agentType === 'UNKNOWN') {
      this.logger.warn(
        `Router intent classifier UNKNOWN — text="${text.slice(0, 60)}" reason="${classification.reason}"`,
      );
      throw new RouterException({
        code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
        message: `사용자 의도를 10개 worker 중 하나로 분류하지 못했습니다. reason: ${classification.reason || '(없음)'}`,
        status: DomainStatus.BAD_REQUEST,
      });
    }
    return {
      agentType: classification.agentType,
      userInstruction: classification.userInstruction,
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
