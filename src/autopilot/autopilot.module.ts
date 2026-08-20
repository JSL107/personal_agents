import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BlogModule } from '../agent/blog/blog.module';
import { CareerMateModule } from '../agent/career-mate/career-mate.module';
import { CeoModule } from '../agent/ceo/ceo.module';
import { CtoModule } from '../agent/cto/cto.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { GenerateOpsAdviceUsecase } from '../agent/ops-supervisor/application/generate-ops-advice.usecase';
import { PaperRecommendModule } from '../agent/paper-recommend/paper-recommend.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { PoShadowModule } from '../agent/po-shadow/po-shadow.module';
import { SyncHoldingsUsecase } from '../agent/stock/application/sync-holdings.usecase';
import { StockMonitorPrismaRepository } from '../agent/stock/infrastructure/stock-monitor.prisma.repository';
import { StockModule } from '../agent/stock/stock.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { AgentRunService } from '../agent-run/application/agent-run.service';
import { AiCliEnvModule } from '../ai-cli-env/ai-cli-env.module';
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
import { PaperTradingModule } from '../paper-trading/paper-trading.module';
import { PrReviewLoopModule } from '../pr-review-loop/pr-review-loop.module';
import { PreferenceProfileModule } from '../preference-profile/preference-profile.module';
import { PreviewGateModule } from '../preview-gate/preview-gate.module';
import { ScreenerModule } from '../screener/screener.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { StudyDeepdiveModule } from '../study-brief-cron/study-deepdive.module';
import { AutopilotOrchestrator } from './application/autopilot.orchestrator';
import { AutopilotScheduler } from './application/autopilot.scheduler';
import { AUTOPILOT_CRON_QUEUE } from './domain/autopilot.type';
import { AUTOPILOT_TASKS } from './domain/autopilot-task.port';
import { AutopilotConsumer } from './infrastructure/autopilot.consumer';
import { AiCliEnvApplyAutopilotTask } from './infrastructure/tasks/ai-cli-env-apply.autopilot-task';
import { AiCliEnvSnapshotAutopilotTask } from './infrastructure/tasks/ai-cli-env-snapshot.autopilot-task';
import { AssignAutopilotTask } from './infrastructure/tasks/assign.autopilot-task';
import { BlogGithubPublishAutopilotTask } from './infrastructure/tasks/blog-github-publish.autopilot-task';
import { CeoMetaAutopilotTask } from './infrastructure/tasks/ceo-meta.autopilot-task';
import { DocsSyncAuditTask } from './infrastructure/tasks/docs-sync-audit.autopilot-task';
import { EveningRetroPublishTask } from './infrastructure/tasks/evening-retro-publish.autopilot-task';
import { ImpactReportAutopilotTask } from './infrastructure/tasks/impact-report.autopilot-task';
import { KnowledgeLintAutopilotTask } from './infrastructure/tasks/knowledge-lint.autopilot-task';
import { MorningBriefingAutopilotTask } from './infrastructure/tasks/morning-briefing.autopilot-task';
import { OpsSupervisorAutopilotTask } from './infrastructure/tasks/ops-supervisor.autopilot-task';
import { PaperOrderFillAutopilotTask } from './infrastructure/tasks/paper-order-fill.autopilot-task';
import { PaperRecommendAutopilotTask } from './infrastructure/tasks/paper-recommend.autopilot-task';
import { PaperScoreAutopilotTask } from './infrastructure/tasks/paper-score.autopilot-task';
import { PaperTradingAutopilotTask } from './infrastructure/tasks/paper-trading.autopilot-task';
import { PoEvalAutopilotTask } from './infrastructure/tasks/po-eval.autopilot-task';
import { PoShadowAutopilotTask } from './infrastructure/tasks/po-shadow.autopilot-task';
import { PortfolioPublishAutopilotTask } from './infrastructure/tasks/portfolio-publish.autopilot-task';
import { PortfolioWarmupAutopilotTask } from './infrastructure/tasks/portfolio-warmup.autopilot-task';
import { PrReviewSweepAutopilotTask } from './infrastructure/tasks/pr-review-sweep.autopilot-task';
import { PreferenceLearningAutopilotTask } from './infrastructure/tasks/preference-learning.autopilot-task';
import { PreviewSweeperAutopilotTask } from './infrastructure/tasks/preview-sweeper.autopilot-task';
import { RunRetroAutopilotTask } from './infrastructure/tasks/run-retro.autopilot-task';
import { RunSweeperAutopilotTask } from './infrastructure/tasks/run-sweeper.autopilot-task';
import { SecretariatAutopilotTask } from './infrastructure/tasks/secretariat.autopilot-task';
import { StockAlertScoringAutopilotTask } from './infrastructure/tasks/stock-alert-scoring.autopilot-task';
import { StockMonitorAutopilotTask } from './infrastructure/tasks/stock-monitor.autopilot-task';
import { StudyDeepdiveAutopilotTask } from './infrastructure/tasks/study-deepdive.autopilot-task';
import { UniverseSweepAutopilotTask } from './infrastructure/tasks/universe-sweep.autopilot-task';
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
    BlogModule,
    CareerMateModule,
    ModelRouterModule,
    PoEvalModule,
    StockModule,
    MarketDataModule,
    PmAgentModule,
    WorkReviewerModule,
    CeoModule,
    CtoModule,
    ImpactReporterModule,
    PoShadowModule,
    AgentRunModule,
    EpisodicMemoryModule,
    HumanizeModule,
    DocsAuditModule,
    PreferenceProfileModule,
    PreviewGateModule,
    PrReviewLoopModule,
    SlackModule,
    NotificationQueueModule,
    PaperTradingModule,
    PaperRecommendModule,
    ScreenerModule,
    AiCliEnvModule,
    StudyDeepdiveModule,
  ],
  providers: [
    AutopilotScheduler,
    AutopilotConsumer,
    AutopilotOrchestrator,
    SystemWakeGuard,
    AssignAutopilotTask,
    PoEvalAutopilotTask,
    PoShadowAutopilotTask,
    SecretariatAutopilotTask,
    MorningBriefingAutopilotTask,
    WorkReviewerAutopilotTask,
    WeeklySummaryAutopilotTask,
    CeoMetaAutopilotTask,
    ImpactReportAutopilotTask,
    RunRetroAutopilotTask,
    RunSweeperAutopilotTask,
    PortfolioPublishAutopilotTask,
    PortfolioWarmupAutopilotTask,
    PreviewSweeperAutopilotTask,
    KnowledgeLintAutopilotTask,
    DocsSyncAuditTask,
    PreferenceLearningAutopilotTask,
    EveningRetroPublishTask,
    BlogGithubPublishAutopilotTask,
    OpsSupervisorAutopilotTask,
    StockAlertScoringAutopilotTask,
    PrReviewSweepAutopilotTask,
    PaperTradingAutopilotTask,
    UniverseSweepAutopilotTask,
    PaperRecommendAutopilotTask,
    PaperOrderFillAutopilotTask,
    PaperScoreAutopilotTask,
    AiCliEnvSnapshotAutopilotTask,
    AiCliEnvApplyAutopilotTask,
    StudyDeepdiveAutopilotTask,
    {
      provide: STOCK_MONITOR_KR_TASK,
      useFactory: (
        marketData: MarketDataPort,
        repository: StockMonitorPrismaRepository,
        configService: ConfigService,
        agentRunService: AgentRunService,
        syncHoldings: SyncHoldingsUsecase,
      ) =>
        new StockMonitorAutopilotTask(
          { id: 'stock-monitor', targetMarketCountry: 'KR' },
          marketData,
          repository,
          configService,
          agentRunService,
          syncHoldings,
        ),
      inject: [
        MARKET_DATA_PORT,
        StockMonitorPrismaRepository,
        ConfigService,
        AgentRunService,
        SyncHoldingsUsecase,
      ],
    },
    {
      provide: STOCK_MONITOR_US_TASK,
      useFactory: (
        marketData: MarketDataPort,
        repository: StockMonitorPrismaRepository,
        configService: ConfigService,
        agentRunService: AgentRunService,
        syncHoldings: SyncHoldingsUsecase,
      ) =>
        new StockMonitorAutopilotTask(
          { id: 'stock-monitor-us', targetMarketCountry: 'US' },
          marketData,
          repository,
          configService,
          agentRunService,
          syncHoldings,
        ),
      inject: [
        MARKET_DATA_PORT,
        StockMonitorPrismaRepository,
        ConfigService,
        AgentRunService,
        SyncHoldingsUsecase,
      ],
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
        assign: AssignAutopilotTask,
        poShadow: PoShadowAutopilotTask,
        poEval: PoEvalAutopilotTask,
        secretariat: SecretariatAutopilotTask,
        morning: MorningBriefingAutopilotTask,
        workReviewer: WorkReviewerAutopilotTask,
        weeklySummary: WeeklySummaryAutopilotTask,
        ceoMeta: CeoMetaAutopilotTask,
        impactReport: ImpactReportAutopilotTask,
        runRetro: RunRetroAutopilotTask,
        runSweeper: RunSweeperAutopilotTask,
        portfolioPublish: PortfolioPublishAutopilotTask,
        portfolioWarmup: PortfolioWarmupAutopilotTask,
        previewSweeper: PreviewSweeperAutopilotTask,
        knowledgeLint: KnowledgeLintAutopilotTask,
        docsSyncAudit: DocsSyncAuditTask,
        preferenceLearning: PreferenceLearningAutopilotTask,
        eveningRetro: EveningRetroPublishTask,
        blogGithubPublish: BlogGithubPublishAutopilotTask,
        opsSupervisor: OpsSupervisorAutopilotTask,
        stockMonitor: StockMonitorAutopilotTask,
        stockMonitorUs: StockMonitorAutopilotTask,
        stockAlertScoring: StockAlertScoringAutopilotTask,
        prReviewSweep: PrReviewSweepAutopilotTask,
        paperTrading: PaperTradingAutopilotTask,
        universeSweep: UniverseSweepAutopilotTask,
        paperRecommend: PaperRecommendAutopilotTask,
        paperOrderFill: PaperOrderFillAutopilotTask,
        paperScore: PaperScoreAutopilotTask,
        aiCliEnvSnapshot: AiCliEnvSnapshotAutopilotTask,
        aiCliEnvApply: AiCliEnvApplyAutopilotTask,
        studyDeepdive: StudyDeepdiveAutopilotTask,
      ) => [
        assign,
        poShadow,
        poEval,
        secretariat,
        morning,
        workReviewer,
        weeklySummary,
        ceoMeta,
        impactReport,
        runRetro,
        runSweeper,
        portfolioPublish,
        portfolioWarmup,
        previewSweeper,
        knowledgeLint,
        docsSyncAudit,
        preferenceLearning,
        eveningRetro,
        blogGithubPublish,
        opsSupervisor,
        stockMonitor,
        stockMonitorUs,
        stockAlertScoring,
        prReviewSweep,
        paperTrading,
        universeSweep,
        paperRecommend,
        paperOrderFill,
        paperScore,
        aiCliEnvSnapshot,
        aiCliEnvApply,
        studyDeepdive,
      ],
      inject: [
        AssignAutopilotTask,
        PoShadowAutopilotTask,
        PoEvalAutopilotTask,
        SecretariatAutopilotTask,
        MorningBriefingAutopilotTask,
        WorkReviewerAutopilotTask,
        WeeklySummaryAutopilotTask,
        CeoMetaAutopilotTask,
        ImpactReportAutopilotTask,
        RunRetroAutopilotTask,
        RunSweeperAutopilotTask,
        PortfolioPublishAutopilotTask,
        PortfolioWarmupAutopilotTask,
        PreviewSweeperAutopilotTask,
        KnowledgeLintAutopilotTask,
        DocsSyncAuditTask,
        PreferenceLearningAutopilotTask,
        EveningRetroPublishTask,
        BlogGithubPublishAutopilotTask,
        OpsSupervisorAutopilotTask,
        STOCK_MONITOR_KR_TASK,
        STOCK_MONITOR_US_TASK,
        StockAlertScoringAutopilotTask,
        PrReviewSweepAutopilotTask,
        PaperTradingAutopilotTask,
        UniverseSweepAutopilotTask,
        PaperRecommendAutopilotTask,
        PaperOrderFillAutopilotTask,
        PaperScoreAutopilotTask,
        AiCliEnvSnapshotAutopilotTask,
        AiCliEnvApplyAutopilotTask,
        StudyDeepdiveAutopilotTask,
      ],
    },
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class AutopilotModule {}
