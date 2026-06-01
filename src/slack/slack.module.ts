import { Module } from '@nestjs/common';

import { BeAgentModule } from '../agent/be/be.module';
import { BeFixModule } from '../agent/be-fix/be-fix.module';
import { BeSchemaModule } from '../agent/be-schema/be-schema.module';
import { BeSreModule } from '../agent/be-sre/be-sre.module';
import { BeTestModule } from '../agent/be-test/be-test.module';
import { CeoModule } from '../agent/ceo/ceo.module';
import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { CtoModule } from '../agent/cto/cto.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { PoShadowModule } from '../agent/po-shadow/po-shadow.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { RouterModule } from '../router/router.module';
import { SlackInboxModule } from '../slack-inbox/slack-inbox.module';
import {
  SLACK_HANDLER_PORT,
  SlackHandler,
} from './domain/port/slack-handler.port';
import { AgentCommandHandler } from './handler/agent-command.handler';
import { AutoFlowHandler } from './handler/auto-flow.handler';
import { BeHandler } from './handler/be.handler';
import { DiagnosisHandler } from './handler/diagnosis.handler';
import { FeedbackCommandHandler } from './handler/feedback-command.handler';
import { PhaseCommandHandler } from './handler/phase-command.handler';
import { PreviewActionHandler } from './handler/preview-action.handler';
import { RetryRunHandler } from './handler/retry-run.handler';
import { RouterMessageHandler } from './handler/router-message.handler';
import { WriteBackHandler } from './handler/write-back.handler';
import { SlackService } from './slack.service';

@Module({
  imports: [
    PmAgentModule,
    WorkReviewerModule,
    CodeReviewerModule,
    ImpactReporterModule,
    PoShadowModule,
    // /be plan|schema|test — 사용자-트리거 백엔드 에이전트 3종 통합 진입점 (SRE/FIX 는 webhook 자동 트리거).
    BeAgentModule,
    BeSchemaModule,
    BeTestModule,
    BeSreModule,
    BeFixModule,
    // V3 비전 P2 Assign — /assign 슬래시 (CTO).
    CtoModule,
    // V3 비전 P4 Evaluate — /po-eval 슬래시 (PO 통합 facade).
    PoEvalModule,
    // V3 비전 P5 Meta — /ceo-review 슬래시 (CEO worker).
    CeoModule,
    // OPS-1 /quota 슬래시 — GetQuotaStatsUsecase 주입.
    AgentRunModule,
    // PO-2 PreviewGate 는 AppModule 에서 forRoot(global: true) 로 한번 등록 — 별도 import 불필요.
    // OPS-3 Slack Reaction → Inbox
    SlackInboxModule,
    // V3 비전 봇 쪼개기 step 5 — 자연어 진입 (app_mention) 시 IdaeriRouterPort.dispatch 로 위임.
    RouterModule,
  ],
  providers: [
    SlackService,
    // C-4 Phase 1 — SlackHandlerRegistry. 각 handler 가 SLACK_HANDLER_PORT multi-provider 로
    // 등록되면 SlackService 가 부팅 시 handlers.forEach(h => h.register(app)) 만 호출.
    // 후속 Phase 에서 나머지 register fn 도 동일 패턴으로 마이그레이션.
    PreviewActionHandler,
    DiagnosisHandler,
    FeedbackCommandHandler,
    WriteBackHandler,
    BeHandler,
    AgentCommandHandler,
    PhaseCommandHandler,
    AutoFlowHandler,
    RetryRunHandler,
    RouterMessageHandler,
    {
      provide: SLACK_HANDLER_PORT,
      useFactory: (...handlers: SlackHandler[]) => handlers,
      inject: [
        PreviewActionHandler,
        DiagnosisHandler,
        FeedbackCommandHandler,
        WriteBackHandler,
        BeHandler,
        AgentCommandHandler,
        PhaseCommandHandler,
        AutoFlowHandler,
        RetryRunHandler,
        RouterMessageHandler,
      ],
    },
  ],
  exports: [SlackService],
})
export class SlackModule {}
