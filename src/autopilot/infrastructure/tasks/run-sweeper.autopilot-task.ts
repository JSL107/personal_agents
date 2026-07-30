import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { STALE_RUN_THRESHOLD_MINUTES } from '../../../agent-run/domain/agent-run.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 좀비 임계를 넘게 IN_PROGRESS 로 고착된 run 을 FAILED 로 sweep한다. 콘솔의 조회 시점 필터와 동일 임계.
@Injectable()
export class RunSweeperAutopilotTask implements AutopilotTask {
  readonly id = 'run-sweeper';

  constructor(private readonly agentRunService: AgentRunService) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const swept = await this.agentRunService.sweepZombies({
      olderThanMinutes: STALE_RUN_THRESHOLD_MINUTES,
    });
    if (swept === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: `🧹 *좀비 정리* — ${STALE_RUN_THRESHOLD_MINUTES}분+ IN_PROGRESS ${swept}건을 FAILED로 정리`,
    };
  }
}
