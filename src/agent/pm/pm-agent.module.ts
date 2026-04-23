import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateDailyPlanUsecase } from './application/generate-daily-plan.usecase';

@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [GenerateDailyPlanUsecase],
  exports: [GenerateDailyPlanUsecase],
})
export class PmAgentModule {}
