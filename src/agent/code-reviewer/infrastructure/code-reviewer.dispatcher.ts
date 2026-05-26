import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatPullRequestReview } from '../../../slack/format/pull-request-review.formatter';
import { ReviewPullRequestUsecase } from '../application/review-pull-request.usecase';

// CODE_REVIEWER worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 prRef 로 매핑.
// classifier 가 자연어에서 PR reference (owner/repo#N) 를 추출해 input.text 로 넘기는 가정.
@Injectable()
export class CodeReviewerDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CODE_REVIEWER;

  constructor(private readonly reviewPullRequest: ReviewPullRequestUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const prRef = input.text ?? '';
    const outcome = await this.reviewPullRequest.execute({
      prRef,
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatPullRequestReview({
        prRef,
        review: outcome.result,
      }),
    };
  }
}
