import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { CodeGraphModule } from '../../code-graph/code-graph.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AnalyzeStackTraceUsecase } from './application/analyze-stack-trace.usecase';

@Module({
  imports: [AgentRunModule, ModelRouterModule, CodeGraphModule],
  providers: [AnalyzeStackTraceUsecase],
  exports: [AnalyzeStackTraceUsecase],
})
export class BeSreModule {}
