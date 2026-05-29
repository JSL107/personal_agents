import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { ImpactReportCronScheduler } from './application/impact-report-cron.scheduler';
import { IMPACT_REPORT_CRON_QUEUE } from './domain/impact-report-cron.type';
import { ImpactReportCronConsumer } from './infrastructure/impact-report-cron.consumer';

// 주 1회 자동 /impact-report --recent <N>d 종합 cron — Daily Eval / Weekly Summary 패턴 답습.
// BullMQ repeatable + SlackNotifierPort (useExisting: SlackService).
@Module({
  imports: [
    BullModule.registerQueue({ name: IMPACT_REPORT_CRON_QUEUE }),
    ImpactReporterModule,
    SlackModule,
  ],
  providers: [
    ImpactReportCronScheduler,
    ImpactReportCronConsumer,
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class ImpactReportCronModule {}
