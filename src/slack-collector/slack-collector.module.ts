import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

import { ListMyMentionsUsecase } from './application/list-my-mentions.usecase';
import {
  SLACK_COLLECTOR_PORT,
  SLACK_WEB_CLIENT,
} from './domain/port/slack-collector.port';
import { SlackWebApiCollector } from './infrastructure/slack-web-api.collector';

// Slack 의 outbound API (web-api) 만 담당하는 모듈.
// SlackModule (Bolt 기반 inbound listener) 과 분리해 PmAgent ↔ Slack 간 순환 import 회피.
// SLACK_BOT_TOKEN 미설정 시 WebClient 는 null — 호출 시점에 친절한 예외 (앱 부팅엔 영향 없음).
@Module({
  providers: [
    ListMyMentionsUsecase,
    {
      provide: SLACK_WEB_CLIENT,
      useFactory: (configService: ConfigService): WebClient | null => {
        const token = configService.get<string>('SLACK_BOT_TOKEN');
        if (!token) {
          return null;
        }
        return new WebClient(token);
      },
      inject: [ConfigService],
    },
    {
      provide: SLACK_COLLECTOR_PORT,
      useClass: SlackWebApiCollector,
    },
  ],
  exports: [ListMyMentionsUsecase, SLACK_COLLECTOR_PORT],
})
export class SlackCollectorModule {}
