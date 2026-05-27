import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatDailyPlan } from '../../../slack/format/daily-plan.formatter';
import { GenerateDailyPlanUsecase } from '../application/generate-daily-plan.usecase';

// PM worker 의 Router dispatcher — Hierarchical Manager Pattern 의 strategy 구현.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4)
//
// 자연어 메시지 (`input.text`) 가 PM 의 tasksText 로 들어가 GenerateDailyPlanUsecase 호출.
// 슬래시 `/today` 핸들러와 동일 usecase 를 우회 — 사용자 가시 차이 X, 단 manager dispatch
// 경로로 진입 가능해 다음 step 의 자연어 / handoff chain 진입점을 열어둔다.
@Injectable()
export class PmDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.PM;

  constructor(private readonly generateDailyPlan: GenerateDailyPlanUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateDailyPlan.execute({
      tasksText: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatDailyPlan(outcome.result.plan),
    };
  }
}
