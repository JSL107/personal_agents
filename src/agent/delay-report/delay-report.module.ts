import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { PreviewGateModule } from '../../preview-gate/preview-gate.module';
import { BuildDelayReportUsecase } from './application/build-delay-report.usecase';
import { DelayReportDispatcher } from './infrastructure/delay-report.dispatcher';

@Module({
  imports: [AgentRunModule, PreviewGateModule],
  providers: [BuildDelayReportUsecase, DelayReportDispatcher],
  exports: [BuildDelayReportUsecase, DelayReportDispatcher],
})
export class DelayReportModule {}
