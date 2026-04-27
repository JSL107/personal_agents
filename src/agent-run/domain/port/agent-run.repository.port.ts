import { AgentType } from '../../../model-router/domain/model-router.type';
import { AgentRunStatus, EvidenceInput, TriggerType } from '../agent-run.type';

export const AGENT_RUN_REPOSITORY_PORT = Symbol('AGENT_RUN_REPOSITORY_PORT');

export interface BeginAgentRunInput {
  agentType: AgentType;
  triggerType: TriggerType;
  // JSON 직렬화 가능한 임의 데이터. Prisma 저장 경계에서만 InputJsonValue 로 cast.
  inputSnapshot: unknown;
}

export interface FinishAgentRunInput {
  id: number;
  status: AgentRunStatus;
  modelUsed?: string;
  output?: unknown;
  // OPS-1 Quota Pane — 어떤 CLI provider 였는지 + execute 소요 시간(ms).
  // SUCCEEDED 든 FAILED 든 가능한 만큼 채워 보내고, FAILED 시 누락돼도 OK (status 만으로 분기 가능).
  cliProvider?: string;
  durationMs?: number;
}

export interface SucceededAgentRunSnapshot {
  id: number;
  output: unknown;
  endedAt: Date;
}

// OPS-1: /quota 슬래시 응답용 — 한 사용자의 특정 시간 범위 내 agent_run 통계.
export interface QuotaStatRow {
  cliProvider: string; // 'codex-cli' / 'claude-cli' / 'gemini-cli' / 'mock' / 'unknown'
  count: number;
  avgDurationMs: number;
  totalDurationMs: number;
}

export interface QuotaStatsQuery {
  // inputSnapshot.slackUserId 매칭 — 다른 사용자 run 을 끌어오지 않도록.
  slackUserId: string;
  // 조회 시작 시각 (이 시각 이후 startedAt). UTC.
  since: Date;
}

export interface AgentRunRepositoryPort {
  begin(input: BeginAgentRunInput): Promise<{ id: number }>;
  finish(input: FinishAgentRunInput): Promise<void>;
  recordEvidence(input: { agentRunId: number } & EvidenceInput): Promise<void>;
  // slackUserId 명시 시 inputSnapshot.slackUserId 와 매칭되는 run 만 검색.
  // /po-shadow 같은 사용자 한정 명령이 다른 사용자 run 을 잡지 않도록 (codex review b6xkjewd2 P2).
  findLatestSucceededRun(input: {
    agentType: AgentType;
    slackUserId?: string;
  }): Promise<SucceededAgentRunSnapshot | null>;
  // OPS-1: cliProvider 별 count + 평균/총 duration 집계 (slackUserId 한정).
  aggregateQuotaStats(input: QuotaStatsQuery): Promise<QuotaStatRow[]>;
}
