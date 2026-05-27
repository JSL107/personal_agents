import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import {
  AGENT_DISPATCHER_PORT,
  provideAgentDispatcher,
} from '../../router/domain/port/agent-dispatcher.port';
import { GenerateBackendPlanUsecase } from './application/generate-backend-plan.usecase';
import { BeDispatcher } from './infrastructure/be.dispatcher';

@Module({
  imports: [ModelRouterModule, AgentRunModule, GithubModule],
  providers: [
    GenerateBackendPlanUsecase,
    BeDispatcher,
    provideAgentDispatcher(BeDispatcher),
  ],
  exports: [GenerateBackendPlanUsecase, AGENT_DISPATCHER_PORT],
})
export class BeAgentModule {}
