import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { BeAgentModule } from './agent/be/be.module';
import { CodeReviewerModule } from './agent/code-reviewer/code-reviewer.module';
import { ImpactReporterModule } from './agent/impact-reporter/impact-reporter.module';
import { PmWriteBackApplier } from './agent/pm/infrastructure/pm-write-back.applier';
import { PmAgentModule } from './agent/pm/pm-agent.module';
import { PoExpandModule } from './agent/po-expand/po-expand.module';
import { PoShadowModule } from './agent/po-shadow/po-shadow.module';
import { WorkReviewerModule } from './agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from './agent-run/agent-run.module';
import { validateEnv } from './config/app.config';
import { CrawlerModule } from './crawler/crawler.module';
import { GithubModule } from './github/github.module';
import { ModelRouterModule } from './model-router/model-router.module';
import { MorningBriefingModule } from './morning-briefing/morning-briefing.module';
import { NotionModule } from './notion/notion.module';
import { PreviewGateModule } from './preview-gate/preview-gate.module';
import { PrismaModule } from './prisma/prisma.module';
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
