import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { CodeGraphModule } from '../../code-graph/code-graph.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AGENT_DISPATCHER_PORT } from '../../router/domain/port/agent-dispatcher.port';
import { AnalyzeStackTraceUsecase } from './application/analyze-stack-trace.usecase';
import { BeSreDispatcher } from './infrastructure/be-sre.dispatcher';

@Module({
  imports: [AgentRunModule, ModelRouterModule, CodeGraphModule],
  providers: [
    AnalyzeStackTraceUsecase,
    BeSreDispatcher,
    {
      provide: AGENT_DISPATCHER_PORT,
      useExisting: BeSreDispatcher,
      multi: true,
    },
  ],
  exports: [AnalyzeStackTraceUsecase, AGENT_DISPATCHER_PORT],
})
export class BeSreModule {}
