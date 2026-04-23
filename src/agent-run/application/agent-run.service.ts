import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import {
  AgentRunStatus,
  EvidenceInput,
  TriggerType,
} from '../domain/agent-run.type';
import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
} from '../domain/port/agent-run.repository.port';

export interface AgentRunExecutionResult<T> {
  result: T;
  modelUsed: string;
  output: Record<string, unknown>;
}

export interface ExecuteAgentRunInput<T> {
  agentType: AgentType;
  triggerType: TriggerType;
  inputSnapshot: Record<string, unknown>;
  evidence?: EvidenceInput[];
  run: () => Promise<AgentRunExecutionResult<T>>;
}

// 모든 에이전트 유스케이스가 공유할 AgentRun 라이프사이클 템플릿.
// begin → run → finish(SUCCEEDED|FAILED) 순서를 강제하고 EvidenceRecord 기록까지 캡슐화한다.
// 기획서 §8 증거 기반 운영 원칙: 모든 에이전트 실행은 DB 에 흔적과 근거를 남겨야 한다.
@Injectable()
export class AgentRunService {
  private readonly logger = new Logger(AgentRunService.name);

  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute<T>({
    agentType,
    triggerType,
    inputSnapshot,
    evidence,
    run,
  }: ExecuteAgentRunInput<T>): Promise<T> {
    const { id } = await this.repository.begin({
      agentType,
      triggerType,
      inputSnapshot,
    });

    // evidence loop 을 try 안에 둬서 recordEvidence 가 throw 하더라도 AgentRun 이 IN_PROGRESS 에 고착되지 않도록 한다.
    try {
      for (const entry of evidence ?? []) {
        await this.repository.recordEvidence({ agentRunId: id, ...entry });
      }

      const execution = await run();

      await this.repository.finish({
        id,
        status: AgentRunStatus.SUCCEEDED,
        modelUsed: execution.modelUsed,
        output: execution.output,
      });

      return execution.result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `AgentRun #${id} (${agentType}) 실패: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.repository.finish({
        id,
        status: AgentRunStatus.FAILED,
        output: { error: message },
      });

      throw error;
    }
  }
}
