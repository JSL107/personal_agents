import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CeoModule } from '../agent/ceo/ceo.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { GenerateOpsAdviceUsecase } from '../agent/ops-supervisor/application/generate-ops-advice.usecase';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { StockMonitorRepository } from '../agent/stock/infrastructure/stock-monitor.repository';
import { StockModule } from '../agent/stock/stock.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { SystemWakeGuard } from '../common/system/system-wake-guard.service';
import { DocsAuditModule } from '../docs-audit/docs-audit.module';
import { EpisodicMemoryModule } from '../episodic-memory/episodic-memory.module';
import { GithubModule } from '../github/github.module';
import { HumanizeModule } from '../humanize/humanize.module';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../market-data/domain/port/market-data.port';
import { MarketDataModule } from '../market-data/market-data.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { OPS_SUPERVISOR_ADVISOR_PORT } from '../ops-supervisor/domain/port/ops-supervisor-advisor.port';
import { PreferenceProfileModule } from '../preference-profile/preference-profile.module';
import { PreviewGateModule } from '../preview-gate/preview-gate.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { AutopilotOrchestrator } from './application/autopilot.orchestrator';
import { AutopilotScheduler } from './application/autopilot.scheduler';
import { AUTOPILOT_CRON_QUEUE } from './domain/autopilot.type';
import { AUTOPILOT_TASKS } from './domain/autopilot-task.port';
import { AutopilotConsumer } from './infrastructure/autopilot.consumer';
import { CeoMetaAutopilotTask } from './infrastructure/tasks/ceo-meta.autopilot-task';
import { DocsSyncAuditTask } from './infrastructure/tasks/docs-sync-audit.autopilot-task';
import { EveningRetroPublishTask } from './infrastructure/tasks/evening-retro-publish.autopilot-task';
import { ImpactReportAutopilotTask } from './infrastructure/tasks/impact-report.autopilot-task';
import { KnowledgeLintAutopilotTask } from './infrastructure/tasks/knowledge-lint.autopilot-task';
import { MorningBriefingAutopilotTask } from './infrastructure/tasks/morning-briefing.autopilot-task';
import { OpsSupervisorAutopilotTask } from './infrastructure/tasks/ops-supervisor.autopilot-task';
import { PoEvalAutopilotTask } from './infrastructure/tasks/po-eval.autopilot-task';
import { PreferenceLearningAutopilotTask } from './infrastructure/tasks/preference-learning.autopilot-task';
import { RunRetroAutopilotTask } from './infrastructure/tasks/run-retro.autopilot-task';
import { RunSweeperAutopilotTask } from './infrastructure/tasks/run-sweeper.autopilot-task';
import { StockMonitorAutopilotTask } from './infrastructure/tasks/stock-monitor.autopilot-task';
import { WeeklySummaryAutopilotTask } from './infrastructure/tasks/weekly-summary.autopilot-task';
import { WorkReviewerAutopilotTask } from './infrastructure/tasks/work-reviewer.autopilot-task';

const STOCK_MONITOR_KR_TASK = Symbol('STOCK_MONITOR_KR_TASK');
const STOCK_MONITOR_US_TASK = Symbol('STOCK_MONITOR_US_TASK');

// Autopilot 골격 — daily-eval.module 패턴(BullMQ repeatable + SlackNotifierPort useExisting).
// CronIdempotencyService 는 @Global(CronIdempotencyModule) 이라 별도 import 불필요.
// SP4: 주간 3종(weekly-summary / ceo-meta / impact-report) task 추가 — CeoModule / ImpactReporterModule import.
@Module({
  imports: [
    BullModule.registerQueue({ name: AUTOPILOT_CRON_QUEUE }),
    GithubModule,
    ModelRouterModule,
    PoEvalModule,
    StockModule,
    MarketDataModule,
    PmAgentModule,
    WorkReviewerModule,
    CeoModule,
    ImpactReporterModule,
    AgentRunModule,
    EpisodicMemoryModule,
    HumanizeModule,
    DocsAuditModule,
    PreferenceProfileModule,
    PreviewGateModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    AutopilotScheduler,
    AutopilotConsumer,
    AutopilotOrchestrator,
    SystemWakeGuard,
    PoEvalAutopilotTask,
    MorningBriefingAutopilotTask,
    WorkReviewerAutopilotTask,
    WeeklySummaryAutopilotTask,
    CeoMetaAutopilotTask,
    ImpactReportAutopilotTask,
    RunRetroAutopilotTask,
    RunSweeperAutopilotTask,
    KnowledgeLintAutopilotTask,
    DocsSyncAuditTask,
    PreferenceLearningAutopilotTask,
    EveningRetroPublishTask,
    OpsSupervisorAutopilotTask,
    {
      provide: STOCK_MONITOR_KR_TASK,
      useFactory: (
        marketData: MarketDataPort,
        repository: StockMonitorRepository,
        configService: ConfigService,
      ) =>
        new StockMonitorAutopilotTask(
          { id: 'stock-monitor', targetMarketCountry: 'KR' },
          marketData,
          repository,
          configService,
        ),
      inject: [MARKET_DATA_PORT, StockMonitorRepository, ConfigService],
    },
    {
      provide: STOCK_MONITOR_US_TASK,
      useFactory: (
        marketData: MarketDataPort,
        repository: StockMonitorRepository,
        configService: ConfigService,
      ) =>
        new StockMonitorAutopilotTask(
          { id: 'stock-monitor-us', targetMarketCountry: 'US' },
          marketData,
          repository,
          configService,
        ),
      inject: [MARKET_DATA_PORT, StockMonitorRepository, ConfigService],
    },
    GenerateOpsAdviceUsecase,
    {
      provide: OPS_SUPERVISOR_ADVISOR_PORT,
      useExisting: GenerateOpsAdviceUsecase,
    },
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
        runSweeper: RunSweeperAutopilotTask,
        knowledgeLint: KnowledgeLintAutopilotTask,
        docsSyncAudit: DocsSyncAuditTask,
        preferenceLearning: PreferenceLearningAutopilotTask,
        eveningRetro: EveningRetroPublishTask,
        opsSupervisor: OpsSupervisorAutopilotTask,
        stockMonitor: StockMonitorAutopilotTask,
        stockMonitorUs: StockMonitorAutopilotTask,
      ) => [
        poEval,
        morning,
        workReviewer,
        weeklySummary,
        ceoMeta,
        impactReport,
        runRetro,
        runSweeper,
        knowledgeLint,
        docsSyncAudit,
        preferenceLearning,
        eveningRetro,
        opsSupervisor,
        stockMonitor,
        stockMonitorUs,
      ],
      inject: [
        PoEvalAutopilotTask,
        MorningBriefingAutopilotTask,
        WorkReviewerAutopilotTask,
        WeeklySummaryAutopilotTask,
        CeoMetaAutopilotTask,
        ImpactReportAutopilotTask,
        RunRetroAutopilotTask,
        RunSweeperAutopilotTask,
        KnowledgeLintAutopilotTask,
        DocsSyncAuditTask,
        PreferenceLearningAutopilotTask,
        EveningRetroPublishTask,
        OpsSupervisorAutopilotTask,
        STOCK_MONITOR_KR_TASK,
        STOCK_MONITOR_US_TASK,
      ],
    },
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class AutopilotModule {}
