import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { formatRunRetro } from '../../../slack/format/run-retro.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import { detectRunAnomalies } from '../../domain/run-retro.anomaly';

const CURRENT_WINDOW_DAYS = 7;
const PREVIOUS_WINDOW_DAYS = 14;

// 주간 실행 회고(조용한 계기판) — 이번주/지난주 두 윈도우로 이상 판정.
// 이상 0건이면 1줄 하트비트, 있으면 경보. 둘 다 0건이면 skip. LLM 없음.
@Injectable()
export class RunRetroAutopilotTask implements AutopilotTask {
  readonly id = 'run-retro';

  constructor(private readonly agentRunService: AgentRunService) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const current = await this.agentRunService.aggregateRunStats({
      sinceDays: CURRENT_WINDOW_DAYS,
      untilDays: 0,
    });
    const previous = await this.agentRunService.aggregateRunStats({
      sinceDays: PREVIOUS_WINDOW_DAYS,
      untilDays: CURRENT_WINDOW_DAYS,
    });
    const anomalies = detectRunAnomalies(current, previous);
    if (current.length === 0 && anomalies.length === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: formatRunRetro(current, anomalies, firedAtKst),
    };
  }
}
