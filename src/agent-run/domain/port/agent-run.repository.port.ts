import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  AgentRunChainNode,
  AgentRunStatus,
  EvidenceInput,
  TriggerType,
} from '../agent-run.type';

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

export interface FailedRunSnapshot {
  id: number;
  agentType: string;
  inputSnapshot: unknown;
  status: string;
}

// PM-3': FTS 유사 plan 조회 결과 단건.
export interface SimilarPlanRow {
  id: number;
  output: unknown;
  endedAt: Date;
  rank: number;
}

// /search-runs: 사용자의 누적 AgentRun (SUCCEEDED) 의 output / inputSnapshot 를 키워드 ILIKE
// 검색해 최근순으로 반환. limit 은 호출자 cap (Slack message 길이 제한 대비).
export interface SearchAgentRunRow {
  id: number;
  agentType: string;
  endedAt: Date;
  output: unknown;
  inputSnapshot: unknown;
}

export interface SearchAgentRunsQuery {
  // inputSnapshot.slackUserId 매칭 — 다른 사용자 run 노출 방지 (quota / po-shadow 와 동일 정책).
  slackUserId: string;
  // ILIKE 대상 키워드. 빈 문자열은 호출자가 거른다 (전체 스캔 회피).
  keyword: string;
  limit: number;
}

// /quota 의 PM 컨텍스트 사용 통계 — input_snapshot 의 inboxItemCount / similarPlanCount 누적.
// OPS-3 / PM-3' 가 실제로 plan 에 주입됐는지 사용자가 직접 확인할 수 있게 한다.
export interface PmContextStats {
  pmRunCount: number;
  totalInboxItems: number;
  pmRunsWithInbox: number;
  totalSimilarPlans: number;
  pmRunsWithSimilar: number;
}

// Run Retro — 최근 N일 agentType 별 실행 통계 단건.
export interface AgentRunStatRow {
  agentType: string;
  total: number;
  failed: number;
  failRate: number; // 0~1 (failed/total)
  avgDurationMs: number;
}

// Ops Supervisor — agentType 별 재시도(FAILURE_REPLAY) 건수.
export interface AgentRetryCountRow {
  agentType: string;
  retries: number;
}

// Ops Supervisor — agentType 별 sweep 된 좀비 건수.
export interface AgentSweptCountRow {
  agentType: string;
  swept: number;
}

export interface AgentRunRepositoryPort {
  begin(input: BeginAgentRunInput): Promise<{ id: number }>;
  finish(input: FinishAgentRunInput): Promise<void>;
  // Router 의 handoff chain 안 child run 에 parent.id 기록 — chain audit log.
  // (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4.4)
  // 호출 시점은 child run 의 begin 이후 (finish 와 무관 — 별도 update).
  updateParentId(input: { id: number; parentId: number }): Promise<void>;
  recordEvidence(input: { agentRunId: number } & EvidenceInput): Promise<void>;
  // slackUserId 명시 시 inputSnapshot.slackUserId 와 매칭되는 run 만 검색.
  // /po-shadow 같은 사용자 한정 명령이 다른 사용자 run 을 잡지 않도록 (codex review b6xkjewd2 P2).
  findLatestSucceededRun(input: {
    agentType: AgentType;
    slackUserId?: string;
  }): Promise<SucceededAgentRunSnapshot | null>;
  // V3-1: 최근 N일간의 성공한 실행 기록 다수 조회.
  findRecentSucceededRuns(input: {
    agentType: AgentType;
    slackUserId?: string;
    sinceDays: number;
    limit: number;
  }): Promise<SucceededAgentRunSnapshot[]>;
  // OPS-1: cliProvider 별 count + 평균/총 duration 집계 (slackUserId 한정).
  aggregateQuotaStats(input: QuotaStatsQuery): Promise<QuotaStatRow[]>;
  // OPS-5: Failure Replay — id 로 AgentRun 단건 조회.
  findById(id: number): Promise<FailedRunSnapshot | null>;
  // PM-3': FTS top-K 유사 plan 조회.
  findSimilarPlans(input: {
    query: string;
    agentType: string;
    limit: number;
    excludeRunId?: number;
  }): Promise<SimilarPlanRow[]>;
  // /quota: PM agent_run.input_snapshot 의 inboxItemCount / similarPlanCount 합산.
  aggregatePmContextStats(input: QuotaStatsQuery): Promise<PmContextStats>;
  // /search-runs: SUCCEEDED 본인 run 중 output / inputSnapshot 에 keyword 가 포함된 것 최근순.
  searchByKeyword(input: SearchAgentRunsQuery): Promise<SearchAgentRunRow[]>;
  // V3 phase loop chain audit — rootRunId 로부터 parentId 역방향 children 까지 recursive 회복.
  // depth 0 (root) → depth N (leaf) 정렬. maxDepth 초과 row 는 결과에서 제외 (사이클 안전망).
  // root run 이 존재하지 않으면 빈 배열.
  findChainFromRoot(input: {
    rootRunId: number;
    maxDepth: number;
  }): Promise<AgentRunChainNode[]>;
  // Episodic 의미검색 결과(agentRunId 목록)로 output/endedAt 재조회 — SimilarPlanRow 복원용.
  findSucceededOutputsByIds(input: {
    ids: number[];
    agentType: string;
  }): Promise<Array<{ id: number; output: unknown; endedAt: Date }>>;
  // Run Retro — 최근 sinceDays~untilDays 윈도우의 agentType 별 실행 통계. untilDays 기본 0(now). 읽기 전용.
  aggregateRunStats(input: {
    sinceDays: number;
    untilDays?: number;
  }): Promise<AgentRunStatRow[]>;
  aggregateRetryCounts(input: {
    sinceDays: number;
  }): Promise<AgentRetryCountRow[]>;
  aggregateSweptCounts(input: {
    sinceDays: number;
  }): Promise<AgentSweptCountRow[]>;
  // 좀비 정리 — cutoff 이전 IN_PROGRESS run 을 FAILED 로 일괄 전환. 정리된 건수 반환.
  sweepZombies(input: { olderThanMinutes: number }): Promise<number>;
}
