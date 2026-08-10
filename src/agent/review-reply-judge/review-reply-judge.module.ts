import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { JudgeFindingResolutionUsecase } from './application/judge-finding-resolution.usecase';
import { JudgeReviewReplyUsecase } from './application/judge-review-reply.usecase';

@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [JudgeReviewReplyUsecase, JudgeFindingResolutionUsecase],
  exports: [JudgeReviewReplyUsecase, JudgeFindingResolutionUsecase],
})
export class ReviewReplyJudgeModule {}
