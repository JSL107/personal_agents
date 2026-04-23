import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { PmAgentModule } from './agent/pm/pm-agent.module';
import { WorkReviewerModule } from './agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from './agent-run/agent-run.module';
import { validateEnv } from './config/app.config';
import { CrawlerModule } from './crawler/crawler.module';
import { ModelRouterModule } from './model-router/model-router.module';
import { PrismaModule } from './prisma/prisma.module';
import { SlackModule } from './slack/slack.module';

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
    PmAgentModule,
    WorkReviewerModule,
    SlackModule,
    CrawlerModule,
  ],
})
export class AppModule {}
