import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { EpisodicMemoryModule } from '../../episodic-memory/episodic-memory.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReviewPullRequestUsecase } from './application/review-pull-request.usecase';
import { SaveReviewOutcomeUsecase } from './application/save-review-outcome.usecase';
import { PR_REVIEW_OUTCOME_REPOSITORY_PORT } from './domain/port/pr-review-outcome.repository.port';
import { CodeReviewerDispatcher } from './infrastructure/code-reviewer.dispatcher';
import { PrReviewOutcomePrismaRepository } from './infrastructure/pr-review-outcome.prisma.repository';

@Module({
  imports: [
    ModelRouterModule,
    AgentRunModule,
    EpisodicMemoryModule,
    GithubModule,
    PrismaModule,
  ],
  providers: [
    ReviewPullRequestUsecase,
    SaveReviewOutcomeUsecase,
    {
      provide: PR_REVIEW_OUTCOME_REPOSITORY_PORT,
      useClass: PrReviewOutcomePrismaRepository,
    },
    CodeReviewerDispatcher,
  ],
  exports: [
    ReviewPullRequestUsecase,
    SaveReviewOutcomeUsecase,
    CodeReviewerDispatcher,
  ],
})
export class CodeReviewerModule {}
