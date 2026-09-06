import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { BlogModule } from './agent/blog/blog.module';
import { EveningBlogPublishApplier } from './agent/blog/infrastructure/evening-blog-publish.applier';
import { GithubBlogPublishApplier } from './agent/blog/infrastructure/github-blog-publish.applier';
import { CareerMateModule } from './agent/career-mate/career-mate.module';
import { EveningCareerReflectApplier } from './agent/career-mate/infrastructure/evening-career-reflect.applier';
import { CeoModule } from './agent/ceo/ceo.module';
import { CodeReviewerModule } from './agent/code-reviewer/code-reviewer.module';
import { CtoModule } from './agent/cto/cto.module';
import { ImpactReporterModule } from './agent/impact-reporter/impact-reporter.module';
import { PaperRecommendModule } from './agent/paper-recommend/paper-recommend.module';
import { PmWriteBackApplier } from './agent/pm/infrastructure/pm-write-back.applier';
import { PmAgentModule } from './agent/pm/pm-agent.module';
import { PoEvalCareerlogApplier } from './agent/po-eval/infrastructure/po-eval-careerlog.applier';
import { PoEvalModule } from './agent/po-eval/po-eval.module';
import { PoShadowModule } from './agent/po-shadow/po-shadow.module';
import { StockModule } from './agent/stock/stock.module';
import { VacationModule } from './agent/vacation/vacation.module';
import { WorkReviewerModule } from './agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from './agent-run/agent-run.module';
import { AiCliEnvModule } from './ai-cli-env/ai-cli-env.module';
import { AiCliEnvApplyPreviewApplier } from './ai-cli-env/infrastructure/ai-cli-env-apply.preview-applier';
import { AutopilotModule } from './autopilot/autopilot.module';
import { CodeGraphModule } from './code-graph/code-graph.module';
import { CronIdempotencyModule } from './common/queue/cron-idempotency.module';
import { WorkerStartupCoordinator } from './common/queue/worker-startup.coordinator';
import { validateEnv } from './config/app.config';
import { ConsoleModule } from './console/console.module';
import { ConsoleEventBusModule } from './console/console-event-bus.module';
import { CrawlerModule } from './crawler/crawler.module';
import { DocsAuditPrApplier } from './docs-audit/infrastructure/docs-audit-pr.applier';
import { GithubModule } from './github/github.module';
import { HumanizeModule } from './humanize/humanize.module';
import { JobApplicationNudgeCronModule } from './job-application-nudge-cron/job-application-nudge-cron.module';
import { LocalSessionsModule } from './local-sessions/local-sessions.module';
import { ModelRouterModule } from './model-router/model-router.module';
import { NotificationModule } from './notification/notification.module';
import { NotionModule } from './notion/notion.module';
import { PaperTradingModule } from './paper-trading/paper-trading.module';
import { PrCareerLogModule } from './pr-careerlog/pr-careerlog.module';
import { PrReviewLoopModule } from './pr-review-loop/pr-review-loop.module';
import { PreferenceProfilePreviewApplier } from './preference-profile/infrastructure/preference-profile.preview-applier';
import { PreferenceProfileCanceller } from './preference-profile/infrastructure/preference-profile.preview-canceller';
import { PreferenceProfileModule } from './preference-profile/preference-profile.module';
import { GithubFileVerifier } from './preview-gate/infrastructure/github-file.verifier';
import { GithubPrVerifier } from './preview-gate/infrastructure/github-pr.verifier';
import { PreviewGateModule } from './preview-gate/preview-gate.module';
import { PrismaModule } from './prisma/prisma.module';
import { ResumeCalibrationCronModule } from './resume-calibration-cron/resume-calibration-cron.module';
import { RouterModule } from './router/router.module';
import { SlackModule } from './slack/slack.module';
import { SlackCollectorModule } from './slack-collector/slack-collector.module';
import { SlackInboxModule } from './slack-inbox/slack-inbox.module';
import { StudyBriefCronModule } from './study-brief-cron/study-brief-cron.module';
import { SubconsciousModule } from './subconscious/subconscious.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
        },
      }),
      inject: [ConfigService],
      // worker 를 앱 부팅 완료(모든 onModuleInit) 후에만 시작하기 위해 자동 등록을 끈다.
      // WorkerStartupCoordinator(OnApplicationBootstrap)가 BullRegistrar.register() 로 수동 시작한다.
      // (부팅 중 밀린 cron job 이 SlackService 등 미준비 의존성을 호출해 실패하던 레이스 방지)
      extraOptions: { manualRegistration: true },
    }),
    // cron 중복 발송 차단 (stalled 재처리 idempotency) — @Global, Redis SETNX. 모든 cron consumer 공용.
    CronIdempotencyModule,
    PrismaModule,
    ModelRouterModule,
    // ConsoleEventBus 전역 제공 — agent-run/preview-gate emit 과 SSE 구독이 같은 버스를 공유.
    ConsoleEventBusModule,
    AgentRunModule,
    // 콘솔 관제 — 읽기(REST) + 실시간(SSE) 표면. AgentRunModule + 전역 PreviewGate 소비, 부작용 0.
    ConsoleModule,
    // V3 SOTA Foundation 1.1 — Tree-sitter Code Graph. 파서 + 스냅샷 스토어 구현 완료.
    // BE-SRE (stack trace 영향 분석) / BE-Schema (스키마 제안) usecase 가 소비.
    CodeGraphModule,
    GithubModule,
    NotionModule,
    SlackCollectorModule,
    PmAgentModule,
    WorkReviewerModule,
    CodeReviewerModule,
    ImpactReporterModule,
    PoShadowModule,
    StockModule,
    PaperTradingModule,
    PaperRecommendModule,
    // V3 SOTA Foundation 1.2 — Docker 격리 실행 환경. BE-Test self-correction 루프(아래)가
    // 소비 — tmpfs 주입으로 호스트 fs 변조 없이 검증.
    // V3 비전 P2 Assign — /assign 슬래시 (CTO). PM 직전 plan 의 assignableTaskIds → BE 3종 분배.
    CtoModule,
    // V3 비전 P4 Evaluate — /po-eval 슬래시 (PO 통합 facade). 3 sub-agent snapshot 합성 + careerLog.
    PoEvalModule,
    // V3 비전 P5 Meta — /ceo-review 슬래시 (CEO worker). PO_EVAL (필수) + PM/CTO (선택) 합성.
    CeoModule,
    // V3 비전 봇 쪼개기 — Hierarchical Manager Pattern (IdaeriRouterPort).
    // 자연어 멘션 → IntentClassifier → 19 worker dispatcher registry 로 dispatch (동작 완료).
    RouterModule,
    // PM-2: PreviewGateModule.forRoot 가 PmWriteBackApplier 를 PREVIEW_APPLIERS multi-provider 로 등록.
    // V3 §P4: PoEvalCareerlogApplier 도 같은 forRoot 로 등록 — Notion appendBlocks 만 의존.
    // global: true 라 SlackModule / PmAgentModule 등은 별도 import 없이 ApplyPreviewUsecase 등 사용 가능.
    PreviewGateModule.forRoot({
      appliers: [
        PmWriteBackApplier,
        PoEvalCareerlogApplier,
        DocsAuditPrApplier,
        PreferenceProfilePreviewApplier,
        AiCliEnvApplyPreviewApplier,
        EveningBlogPublishApplier,
        GithubBlogPublishApplier,
        EveningCareerReflectApplier,
      ],
      // 레버 3b: apply 후 결과 검증 — DOCS_AUDIT_PR 의 PR open 을 getPullRequest 로 재확인.
      verifiers: [GithubPrVerifier, GithubFileVerifier],
      // v2 reject-signal: PREFERENCE_PROFILE 제안 ❌ 거부 시 연결 proposal 을 REJECTED 로 기록.
      cancellers: [PreferenceProfileCanceller],
      imports: [
        GithubModule,
        NotionModule,
        PreferenceProfileModule,
        AiCliEnvModule,
        HumanizeModule,
        ModelRouterModule,
        CareerMateModule,
        LocalSessionsModule,
        // CtoBeChainApplier 는 AgentRunService 도 주입받는다. forRoot 는 applier 를
        // PreviewGate 컨텍스트에서 새로 만들므로, BeChainModule 이 그것을 재수출하지
        // 않는 이상 여기 없으면 부팅이 index[1] 에서 끊긴다(런타임에만 드러난다).
        AgentRunModule,
      ],
    }),
    SlackModule,
    // OPS-3 Slack Reaction → Inbox
    SlackInboxModule,
    // claude CLI 인증 + cron 실패 owner DM 알람 — BullMQ NOTIFICATION_QUEUE 의 consumer.
    // Producer (NotificationQueueModule) 는 ModelRouterModule / 3 cron consumer module 가 직접 imports.
    NotificationModule,
    // workflow-phase-definition §5.2 Daily Eval → Autopilot SP1 실이관 (2026-06-17).
    // 플레이북 선언 + 오케스트레이터 엔진으로 통합. 동작(19:00 KST PO_EVAL Slack 게시) 동등 보존.
    // SP4: 주간 3종(weekly-summary/ceo-meta/impact-report) 도 Autopilot 플레이북으로 통합.
    AutopilotModule,
    // Phase 4 — 주 1회 자동 이력서 보정 점검. Hermes 웹리서치로 2026 트렌드 augment → CAREER_MATE 보정 → Slack DM.
    ResumeCalibrationCronModule,
    // Phase 3 — 매일 자동 지원 넛지. 마감 임박(≤3일)/팔로업 지난 진행 중 지원 건을 SQL 조회 → Slack DM.
    JobApplicationNudgeCronModule,
    CrawlerModule,
    WebhookModule,
    // pull_request.closed (merged=true) → 본인 PR 머지 시 Notion careerLog 자동 적재.
    // WebhookModule 이 BullMQ queue 등록 + controller 분기 — 본 module 은 consumer 본체.
    PrCareerLogModule,
    // 휴가 잔여/등록/내역/취소 — 결정론 계산 (LLM 없음). /휴가 슬래시 핸들러 의존.
    VacationModule,
    // BLOG 릴레이 — 자연어 멘션 전용(@이대리 ... 블로그 써줘). Hermes tistory-blog 스킬을 hermes -z 로 호출.
    // RouterModule 도 BlogModule 을 import 하지만(dispatcher inject), 다른 agent 모듈과 동일하게 여기도 등록.
    BlogModule,
    // Subconscious proactive engine — 20분 tick 으로 상태 변화 감지 → LLM gate → proposal DM.
    // SUBCONSCIOUS_ENABLED='true' + AUTOPILOT_OWNER_SLACK_USER_ID 미설정 시 자동 비활성.
    SubconsciousModule,
    // PR 리뷰 루프 Phase 1 — autopilot pr-review-sweep task 가 스윕 usecase 를 호출한다.
    // PR_REVIEW_LOOP_ENABLED 미설정/false 시 스윕이 즉시 skip(기본 OFF).
    PrReviewLoopModule,
    StudyBriefCronModule,
  ],
  providers: [WorkerStartupCoordinator],
})
export class AppModule {}
