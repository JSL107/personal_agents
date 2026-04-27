import { Module } from '@nestjs/common';

import { BeAgentModule } from '../agent/be/be.module';
import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoShadowModule } from '../agent/po-shadow/po-shadow.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { PreviewGateModule } from '../preview-gate/preview-gate.module';
import { SlackService } from './slack.service';

@Module({
  imports: [
    PmAgentModule,
    WorkReviewerModule,
    CodeReviewerModule,
    ImpactReporterModule,
    PoShadowModule,
    BeAgentModule,
    // OPS-1 /quota 슬래시 — GetQuotaStatsUsecase 주입.
    AgentRunModule,
    // PO-2 Preview Gate — Block Kit apply/cancel 버튼 클릭 처리용 Apply/CancelPreviewUsecase 주입.
    PreviewGateModule,
  ],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
