import { HttpStatus, Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PmAgentException } from '../domain/pm-agent.exception';
import { DailyPlan, GenerateDailyPlanInput } from '../domain/pm-agent.type';
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';
import { parseDailyPlan } from '../domain/prompt/daily-plan.parser';
import { PM_SYSTEM_PROMPT } from '../domain/prompt/pm-system.prompt';

@Injectable()
export class GenerateDailyPlanUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    tasksText,
    slackUserId,
  }: GenerateDailyPlanInput): Promise<DailyPlan> {
    const trimmed = tasksText.trim();
    if (trimmed.length === 0) {
      throw new PmAgentException({
        code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
        message:
          '오늘 할 일이 비어 있습니다. `/today <할 일>` 형식으로 입력해주세요.',
        status: HttpStatus.BAD_REQUEST,
      });
    }

    return this.agentRunService.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { tasksText: trimmed, slackUserId },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_TODAY',
          sourceId: slackUserId,
          payload: { tasksText: trimmed },
        },
      ],
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.PM,
          request: {
            prompt: trimmed,
            systemPrompt: PM_SYSTEM_PROMPT,
          },
        });
        const plan = parseDailyPlan(completion.text);
        return {
          result: plan,
          modelUsed: completion.modelUsed,
          output: plan as unknown as Record<string, unknown>,
        };
      },
    });
  }
}
