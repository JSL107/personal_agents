import { Module } from '@nestjs/common';

import { BeAgentModule } from '../agent/be/be.module';
import { BeFixModule } from '../agent/be-fix/be-fix.module';
import { BeSchemaModule } from '../agent/be-schema/be-schema.module';
import { BeSreModule } from '../agent/be-sre/be-sre.module';
import { BeTestModule } from '../agent/be-test/be-test.module';
import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoShadowModule } from '../agent/po-shadow/po-shadow.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { SlackInboxModule } from '../slack-inbox/slack-inbox.module';
import { SlackService } from './slack.service';

@Module({
  imports: [
    PmAgentModule,
    WorkReviewerModule,
    CodeReviewerModule,
    ImpactReporterModule,
    PoShadowModule,
    // /be plan|schema|test|sre|fix — 5종 백엔드 에이전트의 통합 진입점.
    BeAgentModule,
    BeSchemaModule,
    BeTestModule,
    BeSreModule,
    BeFixModule,
    // OPS-1 /quota 슬래시 — GetQuotaStatsUsecase 주입.
    AgentRunModule,
    // PO-2 PreviewGate 는 AppModule 에서 forRoot(global: true) 로 한번 등록 — 별도 import 불필요.
    // OPS-3 Slack Reaction → Inbox
    SlackInboxModule,
  ],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
