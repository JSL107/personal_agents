import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { HERMES_RUNNER_PORT } from '../agent/blog/domain/port/hermes-runner.port';
import { HermesCliRunner } from '../agent/blog/infrastructure/hermes-cli.runner';
import { CAREER_PROFILE_REPOSITORY_PORT } from '../agent/career-mate/domain/port/career-profile.repository.port';
import { CareerProfilePrismaRepository } from '../agent/career-mate/infrastructure/career-profile.prisma.repository';
import { CtoModule } from '../agent/cto/cto.module';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { NotionModule } from '../notion/notion.module';
import { SLACK_NOTIFIER_PORT } from '../slack/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { StudyBriefCronScheduler } from './application/study-brief-cron.scheduler';
import { INSTALLED_TOOLS_PORT } from './domain/port/installed-tools.port';
import { REPO_CONTEXT_PORT } from './domain/port/repo-context.port';
import { STUDY_BRIEF_REPOSITORY_PORT } from './domain/port/study-brief.repository.port';
import { STUDY_BRIEF_PUBLISHER_PORT } from './domain/port/study-brief-publisher.port';
import { STUDY_BRIEF_CRON_QUEUE } from './domain/study-brief-cron.type';
import { InstalledToolsCollector } from './infrastructure/installed-tools.collector';
import { RepoContextCollector } from './infrastructure/repo-context.collector';
import { StudyBriefPrismaRepository } from './infrastructure/study-brief.prisma.repository';
import { StudyBriefCronConsumer } from './infrastructure/study-brief-cron.consumer';
import { StudyBriefNotionPublisher } from './infrastructure/study-brief-notion.publisher';
import { StudyDiagramModule } from './study-diagram.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: STUDY_BRIEF_CRON_QUEUE }),
    // CTO 판정 전(리서치) 실패를 실행 원장에 남기기 위해 AgentRunService 를 받는다.
    AgentRunModule,
    CtoModule,
    SlackModule,
    NotificationQueueModule,
    NotionModule,
    StudyDiagramModule,
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
    { provide: REPO_CONTEXT_PORT, useClass: RepoContextCollector },
    {
      provide: STUDY_BRIEF_PUBLISHER_PORT,
      useClass: StudyBriefNotionPublisher,
    },
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class StudyBriefCronModule {}
