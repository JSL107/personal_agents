import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { ReviewPullRequestUsecase } from './application/review-pull-request.usecase';

@Module({
  imports: [ModelRouterModule, AgentRunModule, GithubModule],
  providers: [ReviewPullRequestUsecase],
  exports: [ReviewPullRequestUsecase],
})
export class CodeReviewerModule {}
