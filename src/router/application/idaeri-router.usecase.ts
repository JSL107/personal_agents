import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
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
    const agentType =
      input.agentTypeHint ?? (await this.classifyOrThrow(input));

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

    const outcome = await dispatcher.dispatch({
      ...input,
      agentTypeHint: agentType,
    });
    this.logger.log(
      `Router dispatch 완료 — agentType=${agentType} agentRunId=${outcome.agentRunId} model=${outcome.modelUsed} depth=${chain.depth}`,
    );

    // step 8 — handoff chain audit log. parent.id 가 input.contextRefs 에 실려오면 child run 의
    // parentId 컬럼에 기록. 실패는 audit 누락에 그치므로 chain 진행 자체를 멈추지 않는다.
    const parentAgentRunId = input.contextRefs?.agentRunId;
    if (parentAgentRunId !== undefined) {
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
    return this.dispatchInternal(followUpInput, nextChain);
  }

  // agentTypeHint 가 없을 때만 호출된다. text 도 없으면 분류 불가 → INTENT_HINT_REQUIRED.
  // classifier 가 UNKNOWN 반환 시 INTENT_CLASSIFY_FAILED — 사용자에게 의도 모호 안내.
  private async classifyOrThrow(input: DispatchInput): Promise<AgentType> {
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

    const classification = await this.intentClassifier.classify(text);
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
    return classification.agentType;
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
