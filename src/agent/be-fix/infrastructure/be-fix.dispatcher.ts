import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { AnalyzePrConventionUsecase } from '../application/analyze-pr-convention.usecase';

// BE_FIX worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 prRef 로 매핑.
@Injectable()
export class BeFixDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BE_FIX;

  constructor(
    private readonly analyzePrConvention: AnalyzePrConventionUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.analyzePrConvention.execute({
      prRef: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
    };
  }
}
