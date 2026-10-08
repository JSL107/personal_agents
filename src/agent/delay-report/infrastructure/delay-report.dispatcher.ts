import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatDelayReport } from '../../../slack/format/delay-report.formatter';
import { BuildDelayReportUsecase } from '../application/build-delay-report.usecase';

// 결정론 워커지만 AgentRun 을 남긴다 — 0 sentinel 로 두면 실행 원장이 이 워커를 NEVER_RUN 으로 본다.
@Injectable()
export class DelayReportDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.DELAY_REPORT;

  constructor(
    private readonly buildDelayReport: BuildDelayReportUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.agentRunService.execute({
      agentType: AgentType.DELAY_REPORT,
      triggerType: TriggerType.SLACK_MENTION_DELAY_REPORT,
      inputSnapshot: { slackUserId: input.slackUserId },
      run: async () => {
        const verdict = await this.buildDelayReport.execute({
          slackUserId: input.slackUserId,
          now: new Date(),
        });
        return { result: verdict, modelUsed: 'deterministic', output: verdict };
      },
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatDelayReport(outcome.result),
    };
  }
}
