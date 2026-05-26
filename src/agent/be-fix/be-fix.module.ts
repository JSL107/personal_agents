import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AGENT_DISPATCHER_PORT } from '../../router/domain/port/agent-dispatcher.port';
import { AnalyzePrConventionUsecase } from './application/analyze-pr-convention.usecase';
import { BeFixDispatcher } from './infrastructure/be-fix.dispatcher';

@Module({
  imports: [AgentRunModule, ModelRouterModule, GithubModule],
  providers: [
    AnalyzePrConventionUsecase,
    BeFixDispatcher,
    {
      provide: AGENT_DISPATCHER_PORT,
      useExisting: BeFixDispatcher,
      multi: true,
    },
  ],
  exports: [AnalyzePrConventionUsecase, AGENT_DISPATCHER_PORT],
})
export class BeFixModule {}
