import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import {
  CLAUDE_AUTH_ALERT_PORT,
  ClaudeAuthAlertPort,
} from './domain/port/claude-auth-alert.port';
import {
  CRON_FAILURE_ALERT_PORT,
  CronFailureAlertPort,
} from './domain/port/cron-failure-alert.port';
import { NoopClaudeAuthAlerter } from './infrastructure/noop-claude-auth-alerter.service';
import { NoopCronFailureAlerter } from './infrastructure/noop-cron-failure-alerter.service';
import { SlackClaudeAuthAlerter } from './infrastructure/slack-claude-auth-alerter.service';
import { SlackCronFailureAlerter } from './infrastructure/slack-cron-failure-alerter.service';

// @Global — 외부 모듈 (ModelRouterModule / Daily Eval / Impact Report Cron / CEO Meta Cron 등) 이
// NotificationModule 을 imports 없이도 token 만 @Inject 받기 위함. AppModule 에서 1회만 import.
//
// env 정책 — 각 채널 별로 owner Slack user ID 가 따로:
//   CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID — claude CLI 인증 침묵 실패 (ModelRouterUsecase).
//   CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID — cron consumer 실패 (Daily Eval / Impact Report Recent / CEO Meta Cron).
// 미설정 시 각각 Noop 어댑터 (stdout warn 만).
//
// SlackModule 을 imports 해 SlackService 를 useFactory 의 inject 로 받는다. SlackModule 의 의존성
// 그래프 (→ AgentModules → ModelRouterModule) 와 본 모듈 (Global, ModelRouterModule 미 imports) 은
// 순환 없음.
@Global()
@Module({
  imports: [SlackModule],
  providers: [
    NoopClaudeAuthAlerter,
    NoopCronFailureAlerter,
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
    {
      provide: CRON_FAILURE_ALERT_PORT,
      useFactory: (
        configService: ConfigService,
        slackService: SlackService,
        noop: NoopCronFailureAlerter,
      ): CronFailureAlertPort => {
        const ownerId = configService
          .get<string>('CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID')
          ?.trim();
        if (!ownerId || ownerId.length === 0) {
          return noop;
        }
        return new SlackCronFailureAlerter(ownerId, slackService);
      },
      inject: [ConfigService, SlackService, NoopCronFailureAlerter],
    },
  ],
  exports: [CLAUDE_AUTH_ALERT_PORT, CRON_FAILURE_ALERT_PORT],
})
export class NotificationModule {}
