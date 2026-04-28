import { Inject, Injectable } from '@nestjs/common';

import { AgentRunStatus } from '../domain/agent-run.type';
import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
  FailedRunSnapshot,
} from '../domain/port/agent-run.repository.port';

export interface RetryRunPayload {
  id: number;
  agentType: string;
  inputSnapshot: unknown;
}

@Injectable()
export class RetryRunUsecase {
  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute({ id }: { id: number }): Promise<RetryRunPayload | null> {
    const run: FailedRunSnapshot | null = await this.repository.findById(id);
    if (!run || run.status !== AgentRunStatus.FAILED) {
      return null;
    }
    return {
      id: run.id,
      agentType: run.agentType,
      inputSnapshot: run.inputSnapshot,
    };
  }
}
