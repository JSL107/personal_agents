import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { BeAgentModule } from './agent/be/be.module';
import { BeFixModule } from './agent/be-fix/be-fix.module';
import { BeSchemaModule } from './agent/be-schema/be-schema.module';
import { BeSreModule } from './agent/be-sre/be-sre.module';
import { BeTestModule } from './agent/be-test/be-test.module';
import { CodeReviewerModule } from './agent/code-reviewer/code-reviewer.module';
import { ImpactReporterModule } from './agent/impact-reporter/impact-reporter.module';
import { PmWriteBackApplier } from './agent/pm/infrastructure/pm-write-back.applier';
import { PmAgentModule } from './agent/pm/pm-agent.module';
import { PoExpandModule } from './agent/po-expand/po-expand.module';
import { PoShadowModule } from './agent/po-shadow/po-shadow.module';
import { WorkReviewerModule } from './agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from './agent-run/agent-run.module';
import { CodeGraphModule } from './code-graph/code-graph.module';
import { validateEnv } from './config/app.config';
import { CrawlerModule } from './crawler/crawler.module';
import { GithubModule } from './github/github.module';
import { ModelRouterModule } from './model-router/model-router.module';
import { MorningBriefingModule } from './morning-briefing/morning-briefing.module';
import { NotionModule } from './notion/notion.module';
import { PreviewGateModule } from './preview-gate/preview-gate.module';
import { PrismaModule } from './prisma/prisma.module';
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
    PoExpandModule,
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
    // PM-2: PreviewGateModule.forRoot 가 PmWriteBackApplier 를 PREVIEW_APPLIERS multi-provider 로 등록.
    // global: true 라 SlackModule / PmAgentModule 등은 별도 import 없이 ApplyPreviewUsecase 등 사용 가능.
    PreviewGateModule.forRoot({
      appliers: [PmWriteBackApplier],
      imports: [GithubModule, NotionModule],
    }),
    SlackModule,
    // OPS-3 Slack Reaction → Inbox
    SlackInboxModule,
    MorningBriefingModule,
    WeeklySummaryModule,
    CrawlerModule,
    WebhookModule,
  ],
})
export class AppModule {}
