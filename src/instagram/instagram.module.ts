import { Module } from '@nestjs/common';

import { BuildWeeklyInsightReportUsecase } from './application/build-weekly-insight-report.usecase';
import { CollectInsightsUsecase } from './application/collect-insights.usecase';
import { PublishStoryUsecase } from './application/publish-story.usecase';
import { INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT } from './domain/port/instagram-insight-snapshot.repository.port';
import { INSTAGRAM_POST_REPOSITORY_PORT } from './domain/port/instagram-post.repository.port';
import { META_GRAPH_PORT } from './domain/port/meta-graph.port';
import { InstagramInsightSnapshotPrismaRepository } from './infrastructure/instagram-insight-snapshot.prisma.repository';
import { InstagramPostPrismaRepository } from './infrastructure/instagram-post.prisma.repository';
import { MetaGraphClient } from './infrastructure/meta-graph.client';

@Module({
  providers: [
    {
      provide: INSTAGRAM_POST_REPOSITORY_PORT,
      useClass: InstagramPostPrismaRepository,
    },
    {
      provide: INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT,
      useClass: InstagramInsightSnapshotPrismaRepository,
    },
    { provide: META_GRAPH_PORT, useClass: MetaGraphClient },
    PublishStoryUsecase,
    CollectInsightsUsecase,
    BuildWeeklyInsightReportUsecase,
  ],
  exports: [
    INSTAGRAM_POST_REPOSITORY_PORT,
    META_GRAPH_PORT,
    PublishStoryUsecase,
    CollectInsightsUsecase,
    BuildWeeklyInsightReportUsecase,
  ],
})
export class InstagramModule {}
