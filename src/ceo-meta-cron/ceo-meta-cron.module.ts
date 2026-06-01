import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CeoModule } from '../agent/ceo/ceo.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { CeoMetaCronScheduler } from './application/ceo-meta-cron.scheduler';
import { CEO_META_CRON_QUEUE } from './domain/ceo-meta-cron.type';
import { CeoMetaCronConsumer } from './infrastructure/ceo-meta-cron.consumer';

// 주 1회 자동 /ceo-review — Daily Eval 모듈 패턴 차용.
// env CEO_META_CRON_OWNER_SLACK_USER_ID 미설정 시 scheduler 자체가 graceful skip.
@Module({
  imports: [
    BullModule.registerQueue({ name: CEO_META_CRON_QUEUE }),
    CeoModule,
    SlackModule,
  ],
  providers: [
    CeoMetaCronScheduler,
    CeoMetaCronConsumer,
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class CeoMetaCronModule {}
