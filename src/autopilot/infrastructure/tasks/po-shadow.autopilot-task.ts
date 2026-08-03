import { Injectable } from '@nestjs/common';

import { GeneratePoShadowUsecase } from '../../../agent/po-shadow/application/generate-po-shadow.usecase';
import { PoShadowException } from '../../../agent/po-shadow/domain/po-shadow.exception';
import { PoShadowReport } from '../../../agent/po-shadow/domain/po-shadow.type';
import { PoShadowErrorCode } from '../../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { AgentRunOutcome } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatPoShadowReport } from '../../../slack/format/po-shadow.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class PoShadowAutopilotTask implements AutopilotTask {
  readonly id = 'po-shadow';

  constructor(
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
  ) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    let outcome: AgentRunOutcome<PoShadowReport>;
    try {
      outcome = await this.generatePoShadowUsecase.execute({
        slackUserId: ownerSlackUserId,
        extraContext: '',
        triggerType: TriggerType.AUTOPILOT_PO_SHADOW_CRON,
        enforcePlanFreshness: true,
      });
    } catch (error) {
      if (
        error instanceof PoShadowException &&
        (error.poShadowErrorCode === PoShadowErrorCode.NO_RECENT_PLAN ||
          error.poShadowErrorCode === PoShadowErrorCode.STALE_PLAN)
      ) {
        return { skip: true };
      }
      throw error;
    }

    return {
      skip: false,
      summaryText: formatPoShadowReport(outcome.result),
    };
  }
}
