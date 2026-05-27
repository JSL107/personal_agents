import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import {
  AGENT_DISPATCHER_PORT,
  provideAgentDispatcher,
} from '../../router/domain/port/agent-dispatcher.port';
import { GeneratePoShadowUsecase } from './application/generate-po-shadow.usecase';
import { PoShadowDispatcher } from './infrastructure/po-shadow.dispatcher';

@Module({
  imports: [ModelRouterModule, AgentRunModule],
  providers: [
    GeneratePoShadowUsecase,
    PoShadowDispatcher,
    provideAgentDispatcher(PoShadowDispatcher),
  ],
  exports: [GeneratePoShadowUsecase, AGENT_DISPATCHER_PORT],
})
export class PoShadowModule {}
