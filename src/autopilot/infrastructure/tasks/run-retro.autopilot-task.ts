import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { formatRunRetro } from '../../../slack/format/run-retro.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const RETRO_LOOKBACK_DAYS = 7;

// 주간 실행 회고 — 최근 7일 agentType 별 통계를 순수 포맷으로 게시(LLM 없음). 통계 0건이면 skip.
@Injectable()
export class RunRetroAutopilotTask implements AutopilotTask {
  readonly id = 'run-retro';

  constructor(private readonly agentRunService: AgentRunService) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const stats = await this.agentRunService.aggregateRunStats({
      sinceDays: RETRO_LOOKBACK_DAYS,
    });
    if (stats.length === 0) {
      return { skip: true };
    }
    return { skip: false, summaryText: formatRunRetro(stats, firedAtKst) };
  }
}
