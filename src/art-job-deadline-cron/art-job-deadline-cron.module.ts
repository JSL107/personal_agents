import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ArtJobFeedModule } from '../art-job-feed/art-job-feed.module';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SLACK_NOTIFIER_PORT } from '../slack/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { ArtJobDeadlineCronScheduler } from './application/art-job-deadline-cron.scheduler';
import { ART_JOB_DEADLINE_CRON_QUEUE } from './domain/art-job-deadline-cron.type';
import { ArtJobDeadlineCronConsumer } from './infrastructure/art-job-deadline-cron.consumer';

// 「관심 있음」 원화 공고 → 마감 전날 DM. ArtJobFeedCronModule 과 같은 장부(ArtJobPosting)를 읽는다.
// 게시 cron 과 큐를 나눈 것은 scheduler 가 부팅 때 자기 큐의 repeatable 을 전부 지우기 때문이다.
@Module({
  imports: [
    BullModule.registerQueue({ name: ART_JOB_DEADLINE_CRON_QUEUE }),
    ArtJobFeedModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    ArtJobDeadlineCronScheduler,
    ArtJobDeadlineCronConsumer,
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class ArtJobDeadlineCronModule {}
