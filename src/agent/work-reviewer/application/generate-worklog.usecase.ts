import { HttpStatus, Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { parseDailyReview } from '../domain/prompt/daily-review.parser';
import { WORK_REVIEWER_SYSTEM_PROMPT } from '../domain/prompt/work-reviewer-system.prompt';
import { WorkReviewerException } from '../domain/work-reviewer.exception';
import {
  DailyReview,
  GenerateWorklogInput,
} from '../domain/work-reviewer.type';
import { WorkReviewerErrorCode } from '../domain/work-reviewer-error-code.enum';

@Injectable()
export class GenerateWorklogUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    workText,
    slackUserId,
  }: GenerateWorklogInput): Promise<DailyReview> {
    const trimmed = workText.trim();
    if (trimmed.length === 0) {
      throw new WorkReviewerException({
        code: WorkReviewerErrorCode.EMPTY_WORK_INPUT,
        message:
          '오늘 한 일이 비어 있습니다. `/worklog <오늘 한 일>` 형식으로 입력해주세요.',
        status: HttpStatus.BAD_REQUEST,
      });
    }

    return this.agentRunService.execute({
      agentType: AgentType.WORK_REVIEWER,
      triggerType: TriggerType.SLACK_COMMAND_WORKLOG,
      inputSnapshot: { workText: trimmed, slackUserId },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_WORKLOG',
          sourceId: slackUserId,
          payload: { workText: trimmed },
        },
      ],
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.WORK_REVIEWER,
          request: {
            prompt: trimmed,
            systemPrompt: WORK_REVIEWER_SYSTEM_PROMPT,
          },
        });
        const review = parseDailyReview(completion.text);
        return {
          result: review,
          modelUsed: completion.modelUsed,
          output: review as unknown as Record<string, unknown>,
        };
      },
    });
  }
}
