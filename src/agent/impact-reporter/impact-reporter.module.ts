import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AGENT_DISPATCHER_PORT } from '../../router/domain/port/agent-dispatcher.port';
import { GenerateImpactReportUsecase } from './application/generate-impact-report.usecase';
import { ImpactReporterDispatcher } from './infrastructure/impact-reporter.dispatcher';

@Module({
  imports: [ModelRouterModule, AgentRunModule, GithubModule],
  providers: [
    GenerateImpactReportUsecase,
    ImpactReporterDispatcher,
    {
      provide: AGENT_DISPATCHER_PORT,
      useExisting: ImpactReporterDispatcher,
      multi: true,
    },
  ],
  exports: [GenerateImpactReportUsecase, AGENT_DISPATCHER_PORT],
})
export class ImpactReporterModule {}
