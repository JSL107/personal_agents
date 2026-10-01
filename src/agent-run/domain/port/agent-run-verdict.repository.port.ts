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

export interface AgentRunVerdictRepositoryPort {
  // (agentRunId, facet, slackUserId) 기준 덮어쓰기. 처음 판정한 시각(createdAt)은 유지한다.
  record(input: RecordRunVerdictInput): Promise<void>;
  // 한 실행에 내려진 판정 전부(사람별 축별 마지막 값) — 판정 댓글을 다시 그릴 때 쓴다.
  // 댓글은 채널에 하나뿐이라, 누른 사람 것만 그리면 먼저 누른 사람의 판정이 화면에서 사라진다.
  findByRun(agentRunId: number): Promise<RunVerdictRow[]>;
}
