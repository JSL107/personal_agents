import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateWorklogUsecase } from './application/generate-worklog.usecase';

@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [GenerateWorklogUsecase],
  exports: [GenerateWorklogUsecase],
})
export class WorkReviewerModule {}
