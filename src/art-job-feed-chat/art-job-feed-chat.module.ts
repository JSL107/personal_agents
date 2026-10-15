import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { ArtJobFeedModule } from '../art-job-feed/art-job-feed.module';
import { ART_JOB_FEED_CRON_QUEUE } from '../art-job-feed-cron/domain/art-job-feed-cron.type';
import { ArtJobFeedDispatcher } from './infrastructure/art-job-feed.dispatcher';

@Module({
  imports: [
    ArtJobFeedModule,
    AgentRunModule,
    BullModule.registerQueue({ name: ART_JOB_FEED_CRON_QUEUE }),
  ],
  providers: [ArtJobFeedDispatcher],
  exports: [ArtJobFeedDispatcher],
})
export class ArtJobFeedChatModule {}
