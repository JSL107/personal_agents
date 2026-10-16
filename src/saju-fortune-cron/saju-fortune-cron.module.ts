import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../model-router/model-router.module';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SLACK_NOTIFIER_PORT } from '../slack/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { SajuFortuneCronScheduler } from './application/saju-fortune-cron.scheduler';
import { SAJU_FORTUNE_CRON_QUEUE } from './domain/saju-fortune-cron.type';
import { SajuFortuneCronConsumer } from './infrastructure/saju-fortune-cron.consumer';

// 매일 사주 운세 DM — JobApplicationNudgeCron 모듈 패턴 차용.
// CronIdempotencyService 는 @Global CronIdempotencyModule (app.module) 가 제공 — 별도 import 불필요.
@Module({
  imports: [
    BullModule.registerQueue({ name: SAJU_FORTUNE_CRON_QUEUE }),
    ModelRouterModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    SajuFortuneCronScheduler,
    SajuFortuneCronConsumer,
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class SajuFortuneCronModule {}
