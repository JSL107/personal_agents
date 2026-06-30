import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { HERMES_RUNNER_PORT } from '../agent/blog/domain/port/hermes-runner.port';
import { HermesCliRunner } from '../agent/blog/infrastructure/hermes-cli.runner';
import { CareerMateModule } from '../agent/career-mate/career-mate.module';
import { HumanizeModule } from '../humanize/humanize.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { ResumeCalibrationCronScheduler } from './application/resume-calibration-cron.scheduler';
import { RESUME_CALIBRATION_CRON_QUEUE } from './domain/resume-calibration-cron.type';
import { ResumeCalibrationCronConsumer } from './infrastructure/resume-calibration-cron.consumer';

// 주 1회 자동 이력서 보정 점검 — CeoMetaCron 모듈 패턴 차용.
// env RESUME_CALIBRATION_OWNER_SLACK_USER_ID 미설정 시 scheduler 자체가 graceful skip.
// CronIdempotencyService 는 @Global CronIdempotencyModule (app.module) 가 제공 — 별도 import 불필요.
// HERMES_RUNNER_PORT 는 BlogModule 이 미export → 여기서 HermesCliRunner(stateless) 로 재provide.
@Module({
  imports: [
    BullModule.registerQueue({ name: RESUME_CALIBRATION_CRON_QUEUE }),
    CareerMateModule,
    HumanizeModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    ResumeCalibrationCronScheduler,
    ResumeCalibrationCronConsumer,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class ResumeCalibrationCronModule {}
