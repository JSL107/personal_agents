import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatDelayReport } from '../../../slack/format/delay-report.formatter';
import { BuildDelayReportUsecase } from '../application/build-delay-report.usecase';

@Injectable()
export class DelayReportDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.DELAY_REPORT;

  constructor(private readonly buildDelayReport: BuildDelayReportUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const verdict = await this.buildDelayReport.execute({
      slackUserId: input.slackUserId,
      now: new Date(),
    });
    return {
      agentRunId: 0,
      output: verdict,
      modelUsed: 'deterministic',
      formattedText: formatDelayReport(verdict),
    };
  }
}
