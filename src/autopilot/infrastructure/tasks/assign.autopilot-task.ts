import { Injectable } from '@nestjs/common';

import { GenerateAssignmentUsecase } from '../../../agent/cto/application/generate-assignment.usecase';
import { CtoException } from '../../../agent/cto/domain/cto.exception';
import { AssignmentOutput } from '../../../agent/cto/domain/cto.type';
import { CtoErrorCode } from '../../../agent/cto/domain/cto-error-code.enum';
import { AgentRunOutcome } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatAssignmentOutput } from '../../../slack/format/assignment.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class AssignAutopilotTask implements AutopilotTask {
  readonly id = 'assign';

  constructor(
    private readonly generateAssignmentUsecase: GenerateAssignmentUsecase,
  ) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    let outcome: AgentRunOutcome<AssignmentOutput>;
    try {
      outcome = await this.generateAssignmentUsecase.execute({
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.AUTOPILOT_ASSIGN_CRON,
      });
    } catch (error) {
      if (
        error instanceof CtoException &&
        (error.ctoErrorCode === CtoErrorCode.NO_RECENT_PM_RUN ||
          error.ctoErrorCode === CtoErrorCode.STALE_PM_RUN ||
          error.ctoErrorCode === CtoErrorCode.NO_ASSIGNABLE_TASKS)
      ) {
        return { skip: true };
      }
      throw error;
    }

    if (
      outcome.result.assignments.length === 0 &&
      outcome.result.unassignedTasks.length === 0
    ) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: formatAssignmentOutput(outcome.result),
    };
  }
}
