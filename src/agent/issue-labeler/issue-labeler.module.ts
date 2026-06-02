import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { InferIssueLabelsUsecase } from './application/infer-issue-labels.usecase';

@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [InferIssueLabelsUsecase],
  exports: [InferIssueLabelsUsecase],
})
export class IssueLabelerModule {}
