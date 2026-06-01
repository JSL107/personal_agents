import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import {
  CLAUDE_AUTH_ALERT_PORT,
  ClaudeAuthAlertPort,
} from './domain/port/claude-auth-alert.port';
import { NoopClaudeAuthAlerter } from './infrastructure/noop-claude-auth-alerter.service';
import { SlackClaudeAuthAlerter } from './infrastructure/slack-claude-auth-alerter.service';

// @Global — ModelRouterUsecase 가 NotificationModule 을 imports 없이도 CLAUDE_AUTH_ALERT_PORT 를
// inject 받기 위함. AppModule 에서 1회만 import.
//
// CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID env:
//   설정 시 — SlackClaudeAuthAlerter (Slack DM + 30분 dedupe).
//   미설정 시 — NoopClaudeAuthAlerter (stdout warn 만).
//
// SlackModule 을 imports 해 SlackService 를 useFactory 의 inject 로 받는다. SlackModule 의 의존성
// 그래프 (→ AgentModules → ModelRouterModule) 와 본 모듈 (Global, ModelRouterModule 미 imports) 은
// 순환 없음.
@Global()
@Module({
  imports: [SlackModule],
  providers: [
    NoopClaudeAuthAlerter,
    {
      provide: CLAUDE_AUTH_ALERT_PORT,
      useFactory: (
        configService: ConfigService,
        slackService: SlackService,
        noop: NoopClaudeAuthAlerter,
      ): ClaudeAuthAlertPort => {
        const ownerId = configService
          .get<string>('CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID')
          ?.trim();
        if (!ownerId || ownerId.length === 0) {
          return noop;
        }
        return new SlackClaudeAuthAlerter(ownerId, slackService);
      },
      inject: [ConfigService, SlackService, NoopClaudeAuthAlerter],
    },
  ],
  exports: [CLAUDE_AUTH_ALERT_PORT],
})
export class NotificationModule {}
