import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GeneratePoShadowUsecase } from './application/generate-po-shadow.usecase';
import { PoShadowDispatcher } from './infrastructure/po-shadow.dispatcher';

@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [GeneratePoShadowUsecase, PoShadowDispatcher],
  exports: [GeneratePoShadowUsecase, PoShadowDispatcher],
})
export class PoShadowModule {}
