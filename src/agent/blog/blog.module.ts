import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { NotionModule } from '../../notion/notion.module';
import { GenerateBlogDraftUsecase } from './application/generate-blog-draft.usecase';
import { HERMES_RUNNER_PORT } from './domain/port/hermes-runner.port';
import { BLOG_SLACK_NOTIFIER_PORT } from './domain/port/slack-notifier.port';
import { BlogDispatcher } from './infrastructure/blog.dispatcher';
import { HermesCliRunner } from './infrastructure/hermes-cli.runner';
import {
  BLOG_SLACK_WEB_CLIENT,
  SlackWebNotifier,
} from './infrastructure/slack-web.notifier';

// BLOG 릴레이 모듈. model-router 미경유(Hermes 가 모델 자체 선택) → ModelRouterModule import 불필요.
// Notion 자동 발행 enrich 위해 NotionModule import (NOTION_CLIENT_PORT 주입).
// dispatcher 를 export 해 RouterModule 의 AGENT_DISPATCHER_PORT useFactory 가 inject 가능하게 한다.
// SLACK_BOT_TOKEN 미설정 시 WebClient=null → SlackWebNotifier 는 warn noop(부팅 영향 없음).
// (SlackCollectorModule 의 SLACK_WEB_CLIENT 패턴을 모듈 격리 위해 자체 useFactory 로 복제.)
@Module({
  imports: [AgentRunModule, NotionModule],
  providers: [
    GenerateBlogDraftUsecase,
    BlogDispatcher,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
    { provide: BLOG_SLACK_NOTIFIER_PORT, useClass: SlackWebNotifier },
    {
      provide: BLOG_SLACK_WEB_CLIENT,
      useFactory: (configService: ConfigService): WebClient | null => {
        const token = configService.get<string>('SLACK_BOT_TOKEN');
        if (!token) {
          return null;
        }
        return new WebClient(token);
      },
      inject: [ConfigService],
    },
  ],
  exports: [GenerateBlogDraftUsecase, BlogDispatcher],
})
export class BlogModule {}
