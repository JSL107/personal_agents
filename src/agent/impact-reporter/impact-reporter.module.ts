import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { GenerateImpactReportUsecase } from './application/generate-impact-report.usecase';
import { ImpactReporterDispatcher } from './infrastructure/impact-reporter.dispatcher';

@Module({
  imports: [ModelRouterModule, AgentRunModule, GithubModule],
  providers: [GenerateImpactReportUsecase, ImpactReporterDispatcher],
  exports: [GenerateImpactReportUsecase, ImpactReporterDispatcher],
})
export class ImpactReporterModule {}
