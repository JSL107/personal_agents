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
  ],
})
export class AgentRunModule {}
