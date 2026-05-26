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

// Hierarchical Manager Pattern (이대리 비전 봇 쪼개기) 의 manager-agent.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4)
//
// step 2 — Worker dispatcher registry 활성화. AGENT_DISPATCHER_PORT multi-provider 로 등록된
// AgentDispatcher 들을 array 로 받아 agentType → dispatcher 매핑을 boot 시 build.
// agentType=PM 부터 dispatch 실제 동작 (PmDispatcher → GenerateDailyPlanUsecase wrap).
//
// 다음 plan 진입 시 추가될 메커니즘:
//   1. 나머지 9 agent dispatcher 등록 (BE / WORK_REVIEWER / ...).
//   2. intent classifier — agentTypeHint 미지정 시 자연어 → AgentType 1회 LLM 분류.
//   3. handoff chain — followUp 응답 → manager 가 cycle / depth 검증 후 재 dispatch.
@Injectable()
export class IdaeriRouterUsecase implements IdaeriRouterPort {
  private readonly logger = new Logger(IdaeriRouterUsecase.name);
  private readonly dispatcherByType: Map<AgentType, AgentDispatcher>;

  constructor(
    @Inject(AGENT_DISPATCHER_PORT)
    private readonly dispatchers: AgentDispatcher[],
  ) {
    this.dispatcherByType = new Map(
      this.dispatchers.map((dispatcher) => [dispatcher.agentType, dispatcher]),
    );
    this.logger.log(
      `Router dispatcher registry — ${this.dispatcherByType.size}개 worker 등록: ${[...this.dispatcherByType.keys()].join(', ') || '(없음)'}`,
    );
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!input.agentTypeHint) {
      this.logger.warn(
        `Router dispatch — agentTypeHint 누락 (source=${input.source}, user=${input.slackUserId}). intent classifier 도입 전 단계.`,
      );
      throw new RouterException({
        code: RouterErrorCode.INTENT_HINT_REQUIRED,
        message:
          '자연어 intent 분류 단계가 아직 도입되지 않았습니다. agentTypeHint 를 명시하세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const dispatcher = this.dispatcherByType.get(input.agentTypeHint);
    if (!dispatcher) {
      this.logger.warn(
        `Router dispatch — agentType=${input.agentTypeHint} 미등록 dispatcher (등록된 worker: ${[...this.dispatcherByType.keys()].join(', ') || '(없음)'}).`,
      );
      throw new RouterException({
        code: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
        message: `Router 가 agentType=${input.agentTypeHint} dispatcher 를 알지 못합니다. 해당 agent module 이 AGENT_DISPATCHER_PORT 에 등록됐는지 확인하세요.`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const outcome = await dispatcher.dispatch(input);
    this.logger.log(
      `Router dispatch 완료 — agentType=${input.agentTypeHint} agentRunId=${outcome.agentRunId} model=${outcome.modelUsed}`,
    );
    return {
      agentRunId: outcome.agentRunId,
      workerType: input.agentTypeHint,
      output: outcome.output,
      modelUsed: outcome.modelUsed,
      followUp: outcome.followUp,
    };
  }
}
