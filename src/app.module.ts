import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { BeAgentModule } from './agent/be/be.module';
import { BeDiffGeneratorModule } from './agent/be-diff-generator/be-diff-generator.module';
import { BeFixModule } from './agent/be-fix/be-fix.module';
import { BeSandboxApplier } from './agent/be-sandbox/infrastructure/be-sandbox.applier';
import { BeSandboxPushPrApplier } from './agent/be-sandbox/infrastructure/be-sandbox-push-pr.applier';
import { BeSchemaModule } from './agent/be-schema/be-schema.module';
import { BeSreModule } from './agent/be-sre/be-sre.module';
import { BeTestModule } from './agent/be-test/be-test.module';
import { CeoModule } from './agent/ceo/ceo.module';
import { CodeReviewerModule } from './agent/code-reviewer/code-reviewer.module';
import { CtoModule } from './agent/cto/cto.module';
import { ImpactReporterModule } from './agent/impact-reporter/impact-reporter.module';
import { PmWriteBackApplier } from './agent/pm/infrastructure/pm-write-back.applier';
import { PmAgentModule } from './agent/pm/pm-agent.module';
import { PoEvalCareerlogApplier } from './agent/po-eval/infrastructure/po-eval-careerlog.applier';
import { PoEvalModule } from './agent/po-eval/po-eval.module';
import { PoShadowModule } from './agent/po-shadow/po-shadow.module';
import { WorkReviewerModule } from './agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from './agent-run/agent-run.module';
import { CeoMetaCronModule } from './ceo-meta-cron/ceo-meta-cron.module';
import { CodeGraphModule } from './code-graph/code-graph.module';
import { validateEnv } from './config/app.config';
import { CrawlerModule } from './crawler/crawler.module';
import { DailyEvalModule } from './daily-eval/daily-eval.module';
import { GithubModule } from './github/github.module';
import { ImpactReportCronModule } from './impact-report-cron/impact-report-cron.module';
import { ModelRouterModule } from './model-router/model-router.module';
import { MorningBriefingModule } from './morning-briefing/morning-briefing.module';
import { NotificationModule } from './notification/notification.module';
import { NotionModule } from './notion/notion.module';
import { PrCareerLogModule } from './pr-careerlog/pr-careerlog.module';
import { PreviewGateModule } from './preview-gate/preview-gate.module';
import { PrismaModule } from './prisma/prisma.module';
import { RouterModule } from './router/router.module';
import { SandboxModule } from './sandbox/sandbox.module';
import { SlackModule } from './slack/slack.module';
import { SlackCollectorModule } from './slack-collector/slack-collector.module';
import { SlackInboxModule } from './slack-inbox/slack-inbox.module';
import { WebhookModule } from './webhook/webhook.module';
import { WeeklySummaryModule } from './weekly-summary/weekly-summary.module';

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
    }),
    PrismaModule,
    ModelRouterModule,
    AgentRunModule,
    // V3 SOTA Foundation 1.1 — Tree-sitter Code Graph (단계 0: 빈 스캐폴드).
    CodeGraphModule,
    GithubModule,
    NotionModule,
    SlackCollectorModule,
    PmAgentModule,
    WorkReviewerModule,
    CodeReviewerModule,
    ImpactReporterModule,
    PoShadowModule,
    BeAgentModule,
    // V3 BE-3 Schema Architect (lite) — /be-schema 슬래시.
    BeSchemaModule,
    // V3 SOTA Foundation 1.2 — Docker 격리 실행 환경. BE-1 / BE-4 self-correction 루프가
    // 호스트 직접 실행 대신 사용 예정 (현재는 첫 소비자 wiring 전).
    SandboxModule,
    // V3 §8 BE-2 AST Test Gen — /be-test 슬래시. Tree-sitter AST 분석 + spec 생성.
    // (sandbox 검증 루프는 P1 보안 점검 후 도입 — 현재 MVP 는 spec 생성/반환만.)
    BeTestModule,
    // V3 §7 BE-1 Auto-SRE — /be-sre 슬래시. Stack trace 파싱 + Code Graph 영향 분석 + LLM patch 제안.
    BeSreModule,
    // V3 §9 BE-4 Auto-Remediation — /be-fix 슬래시. PR diff fetch + LLM 컨벤션 위반 식별.
    BeFixModule,
    // V3 비전 P2 Assign — /assign 슬래시 (CTO). PM 직전 plan 의 assignableTaskIds → BE 3종 분배.
    CtoModule,
    // V3 비전 P4 Evaluate — /po-eval 슬래시 (PO 통합 facade). 3 sub-agent snapshot 합성 + careerLog.
    PoEvalModule,
    // V3 비전 P5 Meta — /ceo-review 슬래시 (CEO worker). PO_EVAL (필수) + PM/CTO (선택) 합성.
    CeoModule,
    // V3 비전 봇 쪼개기 — Hierarchical Manager Pattern (IdaeriRouterPort) 의 scaffold.
    // 현 단계 dispatch() 는 의도적으로 UNSUPPORTED throw — worker dispatcher registry 도입 plan 진입 전.
    RouterModule,
    // PM-2: PreviewGateModule.forRoot 가 PmWriteBackApplier 를 PREVIEW_APPLIERS multi-provider 로 등록.
    // V3 §P4: PoEvalCareerlogApplier 도 같은 forRoot 로 등록 — Notion appendBlocks 만 의존.
    // V3 Phase 2a-1: BeSandboxApplier 추가 — 사용자 자연어 Y/N 응답 후 sandbox 안 검증.
    // global: true 라 SlackModule / PmAgentModule 등은 별도 import 없이 ApplyPreviewUsecase 등 사용 가능.
    PreviewGateModule.forRoot({
      appliers: [
        PmWriteBackApplier,
        PoEvalCareerlogApplier,
        BeSandboxApplier,
        BeSandboxPushPrApplier,
      ],
      imports: [
        GithubModule,
        NotionModule,
        SandboxModule,
        BeDiffGeneratorModule,
      ],
    }),
    SlackModule,
    // OPS-3 Slack Reaction → Inbox
    SlackInboxModule,
    // claude CLI 인증 + cron 실패 owner DM 알람 — BullMQ NOTIFICATION_QUEUE 의 consumer.
    // Producer (NotificationQueueModule) 는 ModelRouterModule / 3 cron consumer module 가 직접 imports.
    NotificationModule,
    MorningBriefingModule,
    WeeklySummaryModule,
    // workflow-phase-definition §5.2 Daily Eval — 매일 19:00 KST PO_EVAL 자동 트리거.
    DailyEvalModule,
    // 주 1회 자동 /ceo-review — Daily Eval (`0 19 * * *`) 가 누적한 PO_EVAL run 들을 CEO worker 가 합성.
    CeoMetaCronModule,
    // 주 1회 자동 /impact-report --recent <N>d — 본인 머지 PR 자동 종합 (default 토 09:00 KST).
    ImpactReportCronModule,
    CrawlerModule,
    WebhookModule,
    // pull_request.closed (merged=true) → 본인 PR 머지 시 Notion careerLog 자동 적재.
    // WebhookModule 이 BullMQ queue 등록 + controller 분기 — 본 module 은 consumer 본체.
    PrCareerLogModule,
  ],
})
export class AppModule {}
