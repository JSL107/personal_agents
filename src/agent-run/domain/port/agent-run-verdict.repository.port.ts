import { RunVerdictFacet, RunVerdictSource } from '../run-verdict';

export const AGENT_RUN_VERDICT_REPOSITORY_PORT = Symbol(
  'AGENT_RUN_VERDICT_REPOSITORY_PORT',
);

export interface RecordRunVerdictInput {
  agentRunId: number;
  facet: RunVerdictFacet;
  verdict: string;
  slackUserId: string;
  source: RunVerdictSource;
}

export interface RunVerdictRow {
  facet: string;
  verdict: string;
  slackUserId: string;
}

// agentType 별 사람 판정 수. 한 실행에 축·사람이 여럿이면 판정 줄마다 센다.
export interface AgentVerdictCountRow {
  agentType: string;
  total: number;
  good: number;
  bad: number;
}

export interface AgentRunVerdictRepositoryPort {
  // (agentRunId, facet, slackUserId) 기준 덮어쓰기. 처음 판정한 시각(createdAt)은 유지한다.
  record(input: RecordRunVerdictInput): Promise<void>;
  // 한 실행에 내려진 판정 전부(사람별 축별 마지막 값) — 판정 댓글을 다시 그릴 때 쓴다.
  // 댓글은 채널에 하나뿐이라, 누른 사람 것만 그리면 먼저 누른 사람의 판정이 화면에서 사라진다.
  findByRun(agentRunId: number): Promise<RunVerdictRow[]>;
  // 실행 시각이 창 안인 run 에 내려진 판정을 agentType 별로 센다 — 주간 회고가 형식 준수율 옆에
  // 사람 판정을 같이 싣는다(설계 §6). 창 기준을 판정 시각이 아니라 실행 시각으로 두는 것은
  // 형식 준수율(aggregateContractScores)과 같은 실행 묶음을 보게 하려는 것이다.
  countByAgentType(input: {
    sinceDays: number;
    untilDays?: number;
  }): Promise<AgentVerdictCountRow[]>;
}
