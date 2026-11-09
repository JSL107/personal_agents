import { Module } from '@nestjs/common';

import { ProposeReelsFormatUsecase } from '../agent/reels-format-planner/application/propose-reels-format.usecase';
import { AgentRunModule } from '../agent-run/agent-run.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { BuildWeeklyInsightReportUsecase } from './application/build-weekly-insight-report.usecase';
import { CollectInsightsUsecase } from './application/collect-insights.usecase';
import { DecideReelsFormatUsecase } from './application/decide-reels-format.usecase';
import { PublishStoryUsecase } from './application/publish-story.usecase';
import { FORMAT_POLICY_STORE_PORT } from './domain/port/format-policy-store.port';
import { INSTAGRAM_INSIGHT_SNAPSHOT_REPOSITORY_PORT } from './domain/port/instagram-insight-snapshot.repository.port';
import { INSTAGRAM_POST_REPOSITORY_PORT } from './domain/port/instagram-post.repository.port';
import { META_GRAPH_PORT } from './domain/port/meta-graph.port';
import { REEL_FORMAT_DECISION_REPOSITORY_PORT } from './domain/port/reel-format-decision.repository.port';
import { REEL_FORMAT_PLANNER_PORT } from './domain/port/reel-format-planner.port';
import { FormatPolicyFileStore } from './infrastructure/format-policy.file-store';
import { InstagramInsightSnapshotPrismaRepository } from './infrastructure/instagram-insight-snapshot.prisma.repository';
import { InstagramPostPrismaRepository } from './infrastructure/instagram-post.prisma.repository';
import { MetaGraphClient } from './infrastructure/meta-graph.client';
import { ReelFormatDecisionPrismaRepository } from './infrastructure/reel-format-decision.prisma.repository';

@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [
    { provide: FORMAT_POLICY_STORE_PORT, useClass: FormatPolicyFileStore },
    {
      provide: REEL_FORMAT_DECISION_REPOSITORY_PORT,
      useClass: ReelFormatDecisionPrismaRepository,
    },
    ProposeReelsFormatUsecase,
    {
      provide: REEL_FORMAT_PLANNER_PORT,
      useExisting: ProposeReelsFormatUsecase,
    },
    DecideReelsFormatUsecase,
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
    DecideReelsFormatUsecase,
    INSTAGRAM_POST_REPOSITORY_PORT,
    META_GRAPH_PORT,
    PublishStoryUsecase,
    CollectInsightsUsecase,
    BuildWeeklyInsightReportUsecase,
  ],
})
export class InstagramModule {}
