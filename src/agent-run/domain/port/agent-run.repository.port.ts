import { AgentType } from '../../../model-router/domain/model-router.type';
import { AgentRunStatus, EvidenceInput, TriggerType } from '../agent-run.type';

export const AGENT_RUN_REPOSITORY_PORT = Symbol('AGENT_RUN_REPOSITORY_PORT');

export interface BeginAgentRunInput {
  agentType: AgentType;
  triggerType: TriggerType;
  inputSnapshot: Record<string, unknown>;
}

export interface FinishAgentRunInput {
  id: number;
  status: AgentRunStatus;
  modelUsed?: string;
  output?: Record<string, unknown>;
}

export interface AgentRunRepositoryPort {
  begin(input: BeginAgentRunInput): Promise<{ id: number }>;
  finish(input: FinishAgentRunInput): Promise<void>;
  recordEvidence(input: { agentRunId: number } & EvidenceInput): Promise<void>;
}
