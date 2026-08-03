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
  // 직무 계약 검수 결과(ContractViolation[]). 위반이 없으면 미지정.
  // 관측 전용이라 status 판정에는 영향을 주지 않는다.
  contractViolations?: unknown;
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

// 비서실 브리핑 — agentType 별 성공 건수.
// `AgentRunStatRow` 의 `total - failed` 로 대신하면 안 된다. total 은 상태를 가리지 않고
// 세므로 그 뺄셈은 `성공 + 진행 중`이 되어, 지금 돌고 있는 런이 "완료" 로도 집계된다.
export interface AgentSucceededCountRow {
  agentType: string;
  succeeded: number;
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

// PR 리뷰 루프 — 이 PR 을 스윕(triggerType=PR_REVIEW_SWEEP)이 최근 sinceDays 이내 시도한 적
// 있는지 최신 1건. 게시 여부·findings 유무와 무관하게 "리뷰 시도" 자체를 원장으로 삼는다 —
// PrReviewFinding 카드는 연습 모드(dry-run)나 findings 0건일 때 아예 생기지 않으므로 카드
// 유무로는 PR 당 리뷰 1회 정책을 판정할 수 없다(2026-07-31 리뷰 지적으로 AgentRun 원장 기준
// 으로 교정). 리포지토리는 status/startedAt 사실만 반환하고, SUCCEEDED/FAILED/IN_PROGRESS
// 에 따른 재시도 판정(쿨다운)은 usecase 가 순수 로직으로 수행한다(2차 리뷰 지적 반영).
export interface FindLatestSweepReviewQuery {
  prRef: string; // "owner/repo#number" — inputSnapshot.prRef 와 매칭
  sinceDays: number; // JSON path 필터는 인덱스가 없어 스캔 범위를 이 기간으로 제한
}

export interface CountUnsuccessfulSweepReviewsQuery {
  prRef: string;
  sinceHours: number;
}

export interface LatestSweepReview {
  status: string; // AgentRunStatus 값 그대로('SUCCEEDED' | 'FAILED' | 'IN_PROGRESS')
  startedAt: Date;
  // 그 리뷰가 연습 모드(게시 없음)로 돌았는지. inputSnapshot.dryRun 이 없으면(구 레코드·
  // 스윕 외 경로) false. 실게시 전환 후 "연습으로만 끝난 PR"을 다시 리뷰할 근거다.
  dryRun: boolean;
}

// 콘솔 관제(console 모듈) — 현재 IN_PROGRESS 인 활성 런 1건. deriveAgentState 의
// hasActiveRun 신호 소스다. id/endedAt 은 도메인 표현(number/Date)으로 두고,
// 뷰 변환(id → string, endedAt → ISO finishedAt)은 console 조립 계층이 담당한다.
export interface ActiveRunSnapshot {
  id: number;
  agentType: string;
  status: string;
  parentId: number | null;
  startedAt: Date;
  endedAt: Date | null;
}

// 콘솔 관제 — 재접속 스냅샷 복원용. agentType별 "최신 종료 런"의 결과와
// endedAt이 (now - withinMinutes) 이후인 agentType.
//
// 실패만 주던 시절에는 스냅샷이 COMPLETED 를 만들 수 없어, 앱을 껐다 켜면 방금 완료한
// 에이전트가 "대기중" 으로 되살아났다(SSE 라이브로는 완료가 오는데 스냅샷 경로에만 없었다).
// 최신 종료 판정은 어차피 성공/실패를 함께 계산하므로 결과를 그대로 실어 보낸다.
export interface RecentlyFinishedRun {
  agentType: string;
  status: 'SUCCEEDED' | 'FAILED';
}

// 비서실 브리핑 — 최근 N분 안에 끝난 실패 런 **전건**과 그 이유.
// `RecentlyFinishedRun` 과 둘 다 필요한 이유: 저쪽은 agentType 별 "최신 1건" 이라
// (1) 같은 에이전트가 몇 번 실패했는지 셀 수 없고 (2) 실패 이유를 담지 않는다.
// 비서실은 "막힌 것 + 막힌 이유" 를 적고 반복 실패를 결정 후보로 올려야 해서 둘 다 쓴다.
export interface FailedRunDetail {
  agentType: string;
  /** `output.error` 문자열. 기록이 없으면 '이유 미기록'. */
  reason: string;
  endedAt: Date;
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
  // Run Retro chain 관측 — 최근 window 안에서 "자식을 가진 계보의 뿌리" id 목록 (최신순).
  // findChainFromRoot 가 뿌리 id 를 요구하므로 그 입력을 만들어주는 조회다.
  findChainRootsInWindow(input: {
    sinceDays: number;
    limit: number;
  }): Promise<number[]>;
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
  // 콘솔 관제 — 현재 진행 중(IN_PROGRESS) 런 전체 조회. 읽기 전용.
  findActiveRuns(): Promise<ActiveRunSnapshot[]>;
  // PR 리뷰 루프 — PR 당 리뷰 1회(쿨다운 재시도) 판정 근거. FindLatestSweepReviewQuery 주석 참고.
  findLatestSweepReview(
    input: FindLatestSweepReviewQuery,
  ): Promise<LatestSweepReview | null>;
  // PR 리뷰 스윕 — FAILED/IN_PROGRESS 재시도 예산 판정용. 성공하지 못한 시도 수만 반환한다.
  countUnsuccessfulSweepReviews(
    input: CountUnsuccessfulSweepReviewsQuery,
  ): Promise<number>;
  // 콘솔 관제 — agentType별 최신 종료 런의 결과(성공/실패)와 cutoff 이내인 것.
  findRecentlyFinishedRuns(input: {
    withinMinutes: number;
  }): Promise<RecentlyFinishedRun[]>;
  // 비서실 브리핑 — cutoff 이내에 끝난 실패 런 전건 + 이유(최신순).
  findFailedRunsSince(input: {
    withinMinutes: number;
  }): Promise<FailedRunDetail[]>;
  // 비서실 브리핑 — agentType 별 성공 건수(진행 중 제외). **완료 시각** 기준으로 자른다.
  aggregateSucceededCounts(input: {
    sinceDays: number;
  }): Promise<AgentSucceededCountRow[]>;
}
