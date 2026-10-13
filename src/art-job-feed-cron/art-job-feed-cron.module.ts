import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ArtJobFeedModule } from '../art-job-feed/art-job-feed.module';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SLACK_NOTIFIER_PORT } from '../slack/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { ArtJobFeedCronScheduler } from './application/art-job-feed-cron.scheduler';
import { ART_JOB_FEED_CRON_QUEUE } from './domain/art-job-feed-cron.type';
import { ArtJobFeedCronConsumer } from './infrastructure/art-job-feed-cron.consumer';

// 게임잡 원화 공고 → Slack 채널. JobApplicationNudgeCronModule 패턴.
// ART_JOB_FEED_TARGET 미설정 시 scheduler 가 repeatable 을 걸지 않는다.
@Module({
  imports: [
    BullModule.registerQueue({ name: ART_JOB_FEED_CRON_QUEUE }),
    ArtJobFeedModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    ArtJobFeedCronScheduler,
    ArtJobFeedCronConsumer,
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class ArtJobFeedCronModule {}
