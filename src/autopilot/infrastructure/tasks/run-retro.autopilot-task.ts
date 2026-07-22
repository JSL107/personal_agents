import { Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { AgentRunStatus } from '../../../agent-run/domain/agent-run.type';
import { formatRunRetro } from '../../../slack/format/run-retro.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  ChainFailureSummary,
  detectChainFailureAnomalies,
  detectRunAnomalies,
  RunAnomaly,
} from '../../domain/run-retro.anomaly';

const CURRENT_WINDOW_DAYS = 7;
const PREVIOUS_WINDOW_DAYS = 14;
// 한 번의 회고에서 훑을 chain 뿌리 상한 — 재귀 CTE 를 뿌리마다 호출하므로 스캔 폭을 묶어둔다.
const CHAIN_ROOT_SCAN_LIMIT = 20;

// 주간 실행 회고(조용한 계기판) — 이번주/지난주 두 윈도우로 이상 판정.
// 이상 0건이면 1줄 하트비트, 있으면 경보. 둘 다 0건이면 skip. LLM 없음.
// 통계 이상에 더해, 실패 노드를 가진 handoff chain(router / auto-flow / retry 계보)도 지목한다.
@Injectable()
export class RunRetroAutopilotTask implements AutopilotTask {
  readonly id = 'run-retro';
  private readonly logger = new Logger(RunRetroAutopilotTask.name);

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
    const anomalies = [
      ...detectRunAnomalies(current, previous),
      ...(await this.detectChainAnomaliesSafely()),
    ];
    if (current.length === 0 && anomalies.length === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: formatRunRetro(current, anomalies, firedAtKst),
    };
  }

  // chain 관측은 부가 신호다 — 조회가 실패해도 통계 회고 자체는 나가야 하므로 여기서 삼킨다.
  private async detectChainAnomaliesSafely(): Promise<RunAnomaly[]> {
    try {
      const summaries = await this.collectChainFailures();
      return detectChainFailureAnomalies(summaries);
    } catch (error: unknown) {
      this.logger.warn(
        `주간 회고 chain 관측 실패 (통계 회고는 계속): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // 최근 window 의 chain 뿌리를 훑어, 실패 노드를 가진 chain 만 요약으로 남긴다.
  private async collectChainFailures(): Promise<ChainFailureSummary[]> {
    const rootIds = await this.agentRunService.findChainRootsInWindow({
      sinceDays: CURRENT_WINDOW_DAYS,
      limit: CHAIN_ROOT_SCAN_LIMIT,
    });
    const summaries: ChainFailureSummary[] = [];
    for (const rootRunId of rootIds) {
      const nodes = await this.agentRunService.findChainFromRoot(rootRunId);
      if (nodes.length === 0) {
        continue;
      }
      const failedAgentTypes = nodes
        .filter((node) => node.status === AgentRunStatus.FAILED)
        .map((node) => node.agentType);
      if (failedAgentTypes.length === 0) {
        continue;
      }
      summaries.push({
        rootRunId,
        rootAgentType: nodes[0].agentType,
        nodeCount: nodes.length,
        failedAgentTypes,
      });
    }
    return summaries;
  }
}
