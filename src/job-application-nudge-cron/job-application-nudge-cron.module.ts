import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { JobApplicationModule } from '../agent/job-application/job-application.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { JobApplicationNudgeCronScheduler } from './application/job-application-nudge-cron.scheduler';
import { JOB_APPLICATION_NUDGE_CRON_QUEUE } from './domain/job-application-nudge-cron.type';
import { JobApplicationNudgeCronConsumer } from './infrastructure/job-application-nudge-cron.consumer';

// 매일 자동 지원 넛지 — ResumeCalibrationCron 모듈 패턴 차용.
// env JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID 미설정 시 scheduler 자체가 graceful skip.
// CronIdempotencyService 는 @Global CronIdempotencyModule (app.module) 가 제공 — 별도 import 불필요.
// JobApplicationModule 이 JOB_APPLICATION_REPOSITORY_PORT 를 export → consumer 가 동일 repository 주입.
@Module({
  imports: [
    BullModule.registerQueue({ name: JOB_APPLICATION_NUDGE_CRON_QUEUE }),
    JobApplicationModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    JobApplicationNudgeCronScheduler,
    JobApplicationNudgeCronConsumer,
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class JobApplicationNudgeCronModule {}
