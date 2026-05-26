import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { GenerateImpactReportUsecase } from '../application/generate-impact-report.usecase';

// IMPACT_REPORTER worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 subject 로 매핑.
@Injectable()
export class ImpactReporterDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.IMPACT_REPORTER;

  constructor(
    private readonly generateImpactReport: GenerateImpactReportUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateImpactReport.execute({
      subject: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
    };
  }
}
