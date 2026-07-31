import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../../model-router/model-router.module';
import { JudgeReviewReplyUsecase } from './application/judge-review-reply.usecase';

@Module({
  imports: [ModelRouterModule],
  providers: [JudgeReviewReplyUsecase],
  exports: [JudgeReviewReplyUsecase],
})
export class ReviewReplyJudgeModule {}
