import { Module } from '@nestjs/common';

import { EpisodicMemoryModule } from '../episodic-memory/episodic-memory.module';
import { AgentRunService } from './application/agent-run.service';
import { GetQuotaStatsUsecase } from './application/get-quota-stats.usecase';
import { RetryRunUsecase } from './application/retry-run.usecase';
import { SearchAgentRunsUsecase } from './application/search-agent-runs.usecase';
import { AGENT_RUN_REPOSITORY_PORT } from './domain/port/agent-run.repository.port';
import { AgentRunPrismaRepository } from './infrastructure/agent-run.prisma.repository';

@Module({
  imports: [EpisodicMemoryModule],
  providers: [
    AgentRunService,
    GetQuotaStatsUsecase,
    RetryRunUsecase,
    SearchAgentRunsUsecase,
    {
      provide: AGENT_RUN_REPOSITORY_PORT,
      useClass: AgentRunPrismaRepository,
    },
  ],
  exports: [
    AgentRunService,
    GetQuotaStatsUsecase,
    RetryRunUsecase,
    SearchAgentRunsUsecase,
    // 실행 원장 직접 조회 — subconscious 가 "스윕이 이 PR 을 이미 리뷰했는지" 판정에 쓴다.
    AGENT_RUN_REPOSITORY_PORT,
  ],
})
export class AgentRunModule {}
