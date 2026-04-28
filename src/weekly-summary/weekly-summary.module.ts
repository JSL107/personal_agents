import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { WeeklySummaryScheduler } from './application/weekly-summary.scheduler';
import { WEEKLY_SUMMARY_QUEUE } from './domain/weekly-summary.type';
import { WeeklySummaryConsumer } from './infrastructure/weekly-summary.consumer';

@Module({
  imports: [
    BullModule.registerQueue({ name: WEEKLY_SUMMARY_QUEUE }),
    WorkReviewerModule,
    AgentRunModule,
    SlackModule,
  ],
  providers: [
    WeeklySummaryScheduler,
    WeeklySummaryConsumer,
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class WeeklySummaryModule {}
