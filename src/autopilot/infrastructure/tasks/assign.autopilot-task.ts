import { Injectable } from '@nestjs/common';

import { GenerateAssignmentUsecase } from '../../../agent/cto/application/generate-assignment.usecase';
import { CtoException } from '../../../agent/cto/domain/cto.exception';
import { AssignmentOutput } from '../../../agent/cto/domain/cto.type';
import { CtoErrorCode } from '../../../agent/cto/domain/cto-error-code.enum';
import { AgentRunOutcome } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeAssignmentOutput } from '../../../humanize/application/humanize-report.adapter';
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
    private readonly humanizeService: HumanizeService,
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
    // 같은 CTO 분배 산출물인데 `/assign` 슬래시(cto.dispatcher)만 윤문을 거치고 이 자동
    // 발송 경로는 원문 그대로 나가고 있었다. 사람이 읽는 텍스트는 같은 것이므로 맞춘다.
    const humanized = await humanizeAssignmentOutput(
      outcome.result,
      this.humanizeService,
    );
    return {
      skip: false,
      summaryText: formatAssignmentOutput(humanized),
    };
  }
}
