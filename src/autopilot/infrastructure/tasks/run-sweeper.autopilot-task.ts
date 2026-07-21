import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 30분 넘게 IN_PROGRESS 로 고착된 run 을 FAILED 로 sweep한다.
const ZOMBIE_OLDER_THAN_MINUTES = 30;

@Injectable()
export class RunSweeperAutopilotTask implements AutopilotTask {
  readonly id = 'run-sweeper';

  constructor(private readonly agentRunService: AgentRunService) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const swept = await this.agentRunService.sweepZombies({
      olderThanMinutes: ZOMBIE_OLDER_THAN_MINUTES,
    });
    if (swept === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: `🧹 *좀비 정리* — 30분+ IN_PROGRESS ${swept}건을 FAILED로 정리`,
    };
  }
}
