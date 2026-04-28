import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GeneratePoOutlineUsecase } from './application/generate-po-outline.usecase';

@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [GeneratePoOutlineUsecase],
  exports: [GeneratePoOutlineUsecase],
})
export class PoExpandModule {}
