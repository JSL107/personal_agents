import { Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  DispatchInput,
  DispatchResult,
  IdaeriRouterPort,
} from '../domain/idaeri-router.port';
import { RouterException } from '../domain/router.exception';
import { RouterErrorCode } from '../domain/router-error-code.enum';

// Hierarchical Manager Pattern (이대리 비전 봇 쪼개기) 의 manager-agent.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4)
//
// 본 commit 은 scaffold — domain types + module 등록 + manager skeleton 까지만.
// 다음 plan 진입 시 다음 두 메커니즘이 추가되어 dispatch 가 실제 동작한다:
//   1. worker dispatcher registry — agentType → usecase 매핑 strategy.
//   2. intent classifier — agentTypeHint 미지정 시 자연어 → AgentType 1회 LLM 분류.
// 본 단계의 dispatch() 는 의도적으로 항상 throw — 호출되면 fail-fast 로 누락 의존을 명시.
@Injectable()
export class IdaeriRouterUsecase implements IdaeriRouterPort {
  private readonly logger = new Logger(IdaeriRouterUsecase.name);

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!input.agentTypeHint) {
      this.logger.warn(
        `Router scaffold dispatch — agentTypeHint 누락 (source=${input.source}, user=${input.slackUserId}). intent classifier 도입 전 단계.`,
      );
      throw new RouterException({
        code: RouterErrorCode.INTENT_HINT_REQUIRED,
        message:
          '자연어 intent 분류 단계가 아직 도입되지 않았습니다. agentTypeHint 를 명시하세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }
    this.logger.warn(
      `Router scaffold dispatch — agentType=${input.agentTypeHint} 미지원 (worker dispatcher registry 도입 전 단계).`,
    );
    throw new RouterException({
      code: RouterErrorCode.UNSUPPORTED_AGENT_TYPE,
      message: `Router scaffold 단계 — agentType=${input.agentTypeHint} dispatch 는 worker dispatcher registry 도입 plan 진입 후 활성화됩니다.`,
      status: DomainStatus.BAD_REQUEST,
    });
  }
}
