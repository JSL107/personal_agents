import { Injectable } from '@nestjs/common';

import { GenerateDailyPlanUsecase } from '../../../agent/pm/application/generate-daily-plan.usecase';
import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatDailyPlan } from '../../../slack/format/daily-plan.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// Morning Briefing 이관 — 매일 08:30 KST PM /today 자동 발화.
// 기존 src/morning-briefing/infrastructure/morning-briefing.consumer.ts 의 핵심 로직을 task 로 옮김.
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class MorningBriefingAutopilotTask implements AutopilotTask {
  readonly id = 'morning-briefing';

  constructor(private readonly generateDailyPlan: GenerateDailyPlanUsecase) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generateDailyPlan.execute({
        tasksText: '',
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.MORNING_BRIEFING_CRON,
      });
      const text =
        formatDailyPlan(outcome.result.plan) + formatModelFooter(outcome);
      return { skip: false, slackText: text };
    } catch (error) {
      if (
        error instanceof PmAgentException &&
        error.pmAgentErrorCode === PmAgentErrorCode.EMPTY_TASKS_INPUT
      ) {
        return {
          skip: false,
          slackText:
            '오늘 자동 수집된 할 일이 없습니다 (GitHub/Notion/Slack 모두 비어있음). 필요하면 `/today <할 일>` 로 직접 입력해주세요.',
        };
      }
      throw error;
    }
  }
}
