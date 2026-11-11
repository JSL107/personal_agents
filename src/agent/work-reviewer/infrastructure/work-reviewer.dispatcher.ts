import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatDailyReview } from '../../../slack/format/daily-review.formatter';
import { GenerateWorklogUsecase } from '../application/generate-worklog.usecase';

// WORK_REVIEWER worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 workText 로 매핑.
@Injectable()
export class WorkReviewerDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.WORK_REVIEWER;

  constructor(private readonly generateWorklog: GenerateWorklogUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateWorklog.execute({
      workText: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    const formatted = formatDailyReview(outcome.result);
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: `${formatted.summary}\n\n${formatted.detail}`,
    };
  }
}
