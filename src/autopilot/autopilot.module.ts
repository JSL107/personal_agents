import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CeoModule } from '../agent/ceo/ceo.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { DocsAuditModule } from '../docs-audit/docs-audit.module';
import { EpisodicMemoryModule } from '../episodic-memory/episodic-memory.module';
import { HumanizeModule } from '../humanize/humanize.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { AutopilotOrchestrator } from './application/autopilot.orchestrator';
import { AutopilotScheduler } from './application/autopilot.scheduler';
import { AUTOPILOT_CRON_QUEUE } from './domain/autopilot.type';
import { AUTOPILOT_TASKS } from './domain/autopilot-task.port';
import { AutopilotConsumer } from './infrastructure/autopilot.consumer';
import { CeoMetaAutopilotTask } from './infrastructure/tasks/ceo-meta.autopilot-task';
import { DocsSyncAuditTask } from './infrastructure/tasks/docs-sync-audit.autopilot-task';
import { ImpactReportAutopilotTask } from './infrastructure/tasks/impact-report.autopilot-task';
import { KnowledgeLintAutopilotTask } from './infrastructure/tasks/knowledge-lint.autopilot-task';
import { MorningBriefingAutopilotTask } from './infrastructure/tasks/morning-briefing.autopilot-task';
import { PoEvalAutopilotTask } from './infrastructure/tasks/po-eval.autopilot-task';
import { RunRetroAutopilotTask } from './infrastructure/tasks/run-retro.autopilot-task';
import { WeeklySummaryAutopilotTask } from './infrastructure/tasks/weekly-summary.autopilot-task';
import { WorkReviewerAutopilotTask } from './infrastructure/tasks/work-reviewer.autopilot-task';

// Autopilot 골격 — daily-eval.module 패턴(BullMQ repeatable + SlackNotifierPort useExisting).
// CronIdempotencyService 는 @Global(CronIdempotencyModule) 이라 별도 import 불필요.
// SP4: 주간 3종(weekly-summary / ceo-meta / impact-report) task 추가 — CeoModule / ImpactReporterModule import.
@Module({
  imports: [
    BullModule.registerQueue({ name: AUTOPILOT_CRON_QUEUE }),
    PoEvalModule,
    PmAgentModule,
    WorkReviewerModule,
    CeoModule,
    ImpactReporterModule,
    AgentRunModule,
    EpisodicMemoryModule,
    HumanizeModule,
    DocsAuditModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    AutopilotScheduler,
    AutopilotConsumer,
    AutopilotOrchestrator,
    PoEvalAutopilotTask,
    MorningBriefingAutopilotTask,
    WorkReviewerAutopilotTask,
    WeeklySummaryAutopilotTask,
    CeoMetaAutopilotTask,
    ImpactReportAutopilotTask,
    RunRetroAutopilotTask,
    KnowledgeLintAutopilotTask,
    DocsSyncAuditTask,
    {
      // 플레이북 task 레지스트리 — 신규 task 는 여기 inject 에 추가.
      provide: AUTOPILOT_TASKS,
      useFactory: (
        poEval: PoEvalAutopilotTask,
        morning: MorningBriefingAutopilotTask,
        workReviewer: WorkReviewerAutopilotTask,
        weeklySummary: WeeklySummaryAutopilotTask,
        ceoMeta: CeoMetaAutopilotTask,
        impactReport: ImpactReportAutopilotTask,
        runRetro: RunRetroAutopilotTask,
        knowledgeLint: KnowledgeLintAutopilotTask,
        docsSyncAudit: DocsSyncAuditTask,
      ) => [
        poEval,
        morning,
        workReviewer,
        weeklySummary,
        ceoMeta,
        impactReport,
        runRetro,
        knowledgeLint,
        docsSyncAudit,
      ],
      inject: [
        PoEvalAutopilotTask,
        MorningBriefingAutopilotTask,
        WorkReviewerAutopilotTask,
        WeeklySummaryAutopilotTask,
        CeoMetaAutopilotTask,
        ImpactReportAutopilotTask,
        RunRetroAutopilotTask,
        KnowledgeLintAutopilotTask,
        DocsSyncAuditTask,
      ],
    },
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class AutopilotModule {}
