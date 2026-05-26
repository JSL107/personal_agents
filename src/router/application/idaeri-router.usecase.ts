import { Inject, Injectable, Logger } from '@nestjs/common';

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
// step 4 — Intent classifier 통합. agentTypeHint 미지정 + text 있으면 IntentClassifierUsecase
// 가 1회 LLM call 로 자연어 → AgentType 분류 후 dispatch. UNKNOWN 분류는 INTENT_CLASSIFY_FAILED.
// agentTypeHint 도 text 도 없는 케이스만 INTENT_HINT_REQUIRED 로 fail-fast.
@Injectable()
export class IdaeriRouterUsecase implements IdaeriRouterPort {
  private readonly logger = new Logger(IdaeriRouterUsecase.name);
  private readonly dispatcherByType: Map<AgentType, AgentDispatcher>;

  constructor(
    @Inject(AGENT_DISPATCHER_PORT)
    private readonly dispatchers: AgentDispatcher[],
    private readonly intentClassifier: IntentClassifierUsecase,
  ) {
    this.dispatcherByType = new Map(
      this.dispatchers.map((dispatcher) => [dispatcher.agentType, dispatcher]),
    );
    this.logger.log(
      `Router dispatcher registry — ${this.dispatcherByType.size}개 worker 등록: ${[...this.dispatcherByType.keys()].join(', ') || '(없음)'}`,
    );
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
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
      `Router dispatch 완료 — agentType=${agentType} agentRunId=${outcome.agentRunId} model=${outcome.modelUsed}`,
    );
    return {
      agentRunId: outcome.agentRunId,
      workerType: agentType,
      output: outcome.output,
      modelUsed: outcome.modelUsed,
      followUp: outcome.followUp,
    };
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
