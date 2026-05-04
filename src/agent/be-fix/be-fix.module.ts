import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AnalyzePrConventionUsecase } from './application/analyze-pr-convention.usecase';

@Module({
  imports: [AgentRunModule, ModelRouterModule, GithubModule],
  providers: [AnalyzePrConventionUsecase],
  exports: [AnalyzePrConventionUsecase],
})
export class BeFixModule {}
