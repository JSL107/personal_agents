import { Module } from '@nestjs/common';

import { AgentRunService } from './application/agent-run.service';
import { AGENT_RUN_REPOSITORY_PORT } from './domain/port/agent-run.repository.port';
import { AgentRunPrismaRepository } from './infrastructure/agent-run.prisma.repository';

@Module({
  providers: [
    AgentRunService,
    {
      provide: AGENT_RUN_REPOSITORY_PORT,
      useClass: AgentRunPrismaRepository,
    },
  ],
  exports: [AgentRunService],
})
export class AgentRunModule {}
