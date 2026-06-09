import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatAssignmentOutput } from '../../../slack/format/assignment.formatter';
import { GenerateAssignmentUsecase } from '../application/generate-assignment.usecase';

// CTO worker 의 Router dispatcher.
// 진입 surface:
//   - 슬래시 `/assign` (직접 dispatch — input.text 미사용, slackUserId 만)
//   - Router 의 자연어 intent classify 분류 (`CTO` agentType 으로 라우팅 시)
// chain handoff (PM → CTO) 는 본 step 미적용 — PM dispatcher 가 followUp 만들지 않는다.
// dailyPlanAgentRunId 는 본 step 자동 조회만 — input.contextRefs 가 있어도 무시 (warn 후 fallback).
@Injectable()
export class CtoDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CTO;

  constructor(private readonly generateAssignment: GenerateAssignmentUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateAssignment.execute({
      slackUserId: input.slackUserId,
      dailyPlanAgentRunId: input.contextRefs?.agentRunId,
      ...(input.conversationContext !== undefined
        ? { conversationContext: input.conversationContext }
        : {}),
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatAssignmentOutput(outcome.result),
    };
  }
}
