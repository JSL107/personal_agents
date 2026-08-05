import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { HERMES_RUNNER_PORT } from '../agent/blog/domain/port/hermes-runner.port';
import { HermesCliRunner } from '../agent/blog/infrastructure/hermes-cli.runner';
import { CAREER_PROFILE_REPOSITORY_PORT } from '../agent/career-mate/domain/port/career-profile.repository.port';
import { CareerProfilePrismaRepository } from '../agent/career-mate/infrastructure/career-profile.prisma.repository';
import { CtoModule } from '../agent/cto/cto.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { StudyBriefCronScheduler } from './application/study-brief-cron.scheduler';
import { INSTALLED_TOOLS_PORT } from './domain/port/installed-tools.port';
import { STUDY_BRIEF_REPOSITORY_PORT } from './domain/port/study-brief.repository.port';
import { STUDY_BRIEF_CRON_QUEUE } from './domain/study-brief-cron.type';
import { InstalledToolsCollector } from './infrastructure/installed-tools.collector';
import { StudyBriefPrismaRepository } from './infrastructure/study-brief.prisma.repository';
import { StudyBriefCronConsumer } from './infrastructure/study-brief-cron.consumer';

@Module({
  imports: [
    BullModule.registerQueue({ name: STUDY_BRIEF_CRON_QUEUE }),
    CtoModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    StudyBriefCronScheduler,
    StudyBriefCronConsumer,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
    {
      provide: CAREER_PROFILE_REPOSITORY_PORT,
      useClass: CareerProfilePrismaRepository,
    },
    {
      provide: STUDY_BRIEF_REPOSITORY_PORT,
      useClass: StudyBriefPrismaRepository,
    },
    { provide: INSTALLED_TOOLS_PORT, useClass: InstalledToolsCollector },
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class StudyBriefCronModule {}
