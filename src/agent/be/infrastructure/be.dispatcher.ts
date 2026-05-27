import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatBackendPlan } from '../../../slack/format/backend-plan.formatter';
import { GenerateBackendPlanUsecase } from '../application/generate-backend-plan.usecase';

// BE worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 subject 로 매핑.
@Injectable()
export class BeDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BE;

  constructor(
    private readonly generateBackendPlan: GenerateBackendPlanUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateBackendPlan.execute({
      subject: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatBackendPlan(outcome.result),
    };
  }
}
