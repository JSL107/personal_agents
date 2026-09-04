import { Injectable } from '@nestjs/common';

import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeBackendPlan } from '../../../humanize/application/humanize-report.adapter';
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
    private readonly humanizeService: HumanizeService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateBackendPlan.execute({
      subject: input.text ?? '',
      slackUserId: input.slackUserId,
      ...(input.conversationContext !== undefined
        ? { conversationContext: input.conversationContext }
        : {}),
      ...(input.prReferenceHint !== undefined
        ? { prReferenceHint: input.prReferenceHint }
        : {}),
    });

    const humanized = await humanizeBackendPlan(
      outcome.result,
      this.humanizeService,
    );

    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatBackendPlan(humanized),
    };
  }
}
