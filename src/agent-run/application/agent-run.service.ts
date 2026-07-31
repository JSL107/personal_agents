import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import {
  ConsoleAgentState,
  ConsoleRun,
} from '../../console/domain/console.type';
import { EPISODIC_MEMORY_PORT } from '../../episodic-memory/domain/port/episodic-memory.port';
import { EpisodicMemoryPort } from '../../episodic-memory/domain/port/episodic-memory.port';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  AgentRunChainNode,
  AgentRunStatus,
  EvidenceInput,
  TriggerType,
} from '../domain/agent-run.type';
import {
  ActiveRunSnapshot,
  AGENT_RUN_REPOSITORY_PORT,
  AgentRetryCountRow,
  AgentRunRepositoryPort,
  AgentRunStatRow,
  AgentSweptCountRow,
  FindLatestSweepReviewQuery,
  LatestSweepReview,
  SimilarPlanRow,
  SucceededAgentRunSnapshot,
} from '../domain/port/agent-run.repository.port';

// V3 chain (PM → CTO → BE × N → PO_EVAL → CEO) 의 worst-case 가 5-6 단계 — 16 은 사이클
// 안전망 + 미래 확장 여유. 본 상수가 변경되면 chain 회복 결과 크기 (Slack message / DB I/O) 도
// 변동 — production 운영 후 P99 측정 결과 따라 조정 가능. 본 상수가 hard upper bound 도 겸함 —
// caller 가 더 큰 값 넘겨도 service 가 clamp 하여 DoS (recursive CTE 깊이 폭발) 차단.
const DEFAULT_CHAIN_MAX_DEPTH = 16;

export interface AgentRunExecutionResult<T> {
  result: T;
  modelUsed: string;
  // output 은 JSON 직렬화 가능한 임의 데이터 — domain 객체 그대로 전달 가능.
  // Prisma 저장 경계에서만 InputJsonValue 로 cast.
  output: unknown;
}

export interface AgentRunContext {
  agentRunId: number;
}

export interface ExecuteAgentRunInput<T> {
  agentType: AgentType;
  triggerType: TriggerType;
  inputSnapshot: unknown;
  evidence?: EvidenceInput[];
  run: (context: AgentRunContext) => Promise<AgentRunExecutionResult<T>>;
}

// execute 의 외부 노출 형태 — 도메인 결과(result) 와 라우팅 메타(modelUsed/agentRunId) 분리.
// SlackService formatter 가 footer 렌더링에 modelUsed/agentRunId 를 사용하고 (PRO-3),
// 후속 OPS-1 Quota Pane 도 동일 outcome 을 재활용한다.
export interface AgentRunOutcome<T> {
  result: T;
  modelUsed: string;
  agentRunId: number;
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
    // Episodic Memory 는 옵셔널 — AgentRunModule 이 EpisodicMemoryModule 을 import 하면 주입,
    // 미주입(테스트 등) 시 finish hook / findSimilarPlans 는 기존 동작으로 fallback.
    @Optional()
    @Inject(EPISODIC_MEMORY_PORT)
    private readonly episodicMemory?: EpisodicMemoryPort,
    // 콘솔 관제 이벤트 버스 — ConsoleEventBusModule(@Global) 이 production 에 항상 주입.
    // 미주입(단위 테스트) 시 emit 은 no-op (관제는 부가 기능이라 run 흐름을 막지 않는다).
    @Optional()
    private readonly consoleEvents?: ConsoleEventBus,
  ) {}

  // 콘솔 관제용 ConsoleRun 뷰 조립 — id/시각을 뷰 표현(string/ISO)으로 변환.
  private buildConsoleRun(
    id: number,
    agentType: AgentType,
    status: AgentRunStatus,
    startedAt: Date,
    finishedAt: Date | null,
  ): ConsoleRun {
    return {
      id: String(id),
      agentType,
      status,
      parentId: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt === null ? null : finishedAt.toISOString(),
    };
  }

  async execute<T>({
    agentType,
    triggerType,
    inputSnapshot,
    evidence,
    run,
  }: ExecuteAgentRunInput<T>): Promise<AgentRunOutcome<T>> {
    const { id } = await this.repository.begin({
      agentType,
      triggerType,
      inputSnapshot,
    });

    // OPS-1 Quota Pane — execute 소요 시간을 finish 호출 시 함께 기록.
    // begin 직후 시점부터 측정해 evidence 기록 + run 콜백 + finish 직전까지의 elapsed 가 잡힌다.
    const startMs = Date.now();
    const startedAt = new Date(startMs);

    // 콘솔 관제 — 런 시작 알림(run.started + IN_PROGRESS). emit 은 부가 기능이라 흐름을 막지 않는다.
    this.consoleEvents?.publish({
      type: 'run.started',
      run: this.buildConsoleRun(
        id,
        agentType,
        AgentRunStatus.IN_PROGRESS,
        startedAt,
        null,
      ),
    });
    this.consoleEvents?.publish({
      type: 'state.changed',
      agentType,
      state: ConsoleAgentState.IN_PROGRESS,
    });

    // evidence loop 을 try 안에 둬서 recordEvidence 가 throw 하더라도 AgentRun 이 IN_PROGRESS 에 고착되지 않도록 한다.
    try {
      for (const entry of evidence ?? []) {
        await this.repository.recordEvidence({ agentRunId: id, ...entry });
      }

      const execution = await run({ agentRunId: id });

      await this.repository.finish({
        id,
        status: AgentRunStatus.SUCCEEDED,
        modelUsed: execution.modelUsed,
        output: execution.output,
        cliProvider: execution.modelUsed,
        durationMs: Date.now() - startMs,
      });

      // 콘솔 관제 — 성공 종료 알림(run.finished + COMPLETED).
      this.consoleEvents?.publish({
        type: 'run.finished',
        run: this.buildConsoleRun(
          id,
          agentType,
          AgentRunStatus.SUCCEEDED,
          startedAt,
          new Date(),
        ),
      });
      this.consoleEvents?.publish({
        type: 'state.changed',
        agentType,
        state: ConsoleAgentState.COMPLETED,
      });

      // Episodic Memory 적재 — fire-and-forget(await 안 함). 임베딩 모델 로드/추론이 본 흐름을
      // 지연시키지 않도록 떼어내고, record 내부가 이미 실패 swallow 하지만 unhandled rejection 방지로 catch.
      this.recordEpisode(id, agentType, execution.output);

      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: id,
      };
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
        // FAILED 시에도 가능한 만큼 duration 기록 — quota 분석 시 실패 비율도 함께 보임.
        // cliProvider 는 run 콜백이 throw 한 경우 모를 수 있어 옵션 (그 경우 'unknown' 으로 집계됨).
        durationMs: Date.now() - startMs,
      });

      // 콘솔 관제 — 실패 종료 알림(run.finished(FAILED) + WAITING).
      // 실패는 COMPLETED 가 아니라 deriveAgentState 규칙에 맞춰 WAITING 으로 강등한다.
      this.consoleEvents?.publish({
        type: 'run.finished',
        run: this.buildConsoleRun(
          id,
          agentType,
          AgentRunStatus.FAILED,
          startedAt,
          new Date(),
        ),
      });
      this.consoleEvents?.publish({
        type: 'state.changed',
        agentType,
        state: ConsoleAgentState.WAITING,
      });

      throw error;
    }
  }

  // SUCCEEDED run 의 output 을 텍스트화해 episodic memory 에 비동기 적재. 미주입 시 noop.
  private recordEpisode(
    agentRunId: number,
    agentType: AgentType,
    output: unknown,
  ): void {
    if (!this.episodicMemory) {
      return;
    }
    const content =
      typeof output === 'string' ? output : JSON.stringify(output ?? {});
    void this.episodicMemory
      .record({
        kind: 'agent_run',
        agentRunId,
        agentType,
        content,
        occurredAt: new Date(),
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Episodic 적재 비동기 실패 (swallow): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  // V3 비전 봇 쪼개기 step 8 — Router 의 handoff chain 안에서 child run 에 parent.id 기록.
  // (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4.4)
  // manager 가 dispatcher.dispatch 호출 직후 (child outcome 받은 시점) 에 호출.
  // FAILED row 에도 안전 — id 만 매칭되면 update.
  async setParentId({
    id,
    parentId,
  }: {
    id: number;
    parentId: number;
  }): Promise<void> {
    await this.repository.updateParentId({ id, parentId });
  }

  // 가장 최근 SUCCEEDED AgentRun 1건 조회. slackUserId 옵셔널 — 명시 시 inputSnapshot.slackUserId 매칭.
  async findLatestSucceededRun({
    agentType,
    slackUserId,
  }: {
    agentType: AgentType;
    slackUserId?: string;
  }): Promise<SucceededAgentRunSnapshot | null> {
    return this.repository.findLatestSucceededRun({ agentType, slackUserId });
  }

  // V3-1: 최근 N일간의 성공한 실행 기록 다수 조회.
  async findRecentSucceededRuns(input: {
    agentType: AgentType;
    slackUserId?: string;
    sinceDays: number;
    limit: number;
  }): Promise<SucceededAgentRunSnapshot[]> {
    return this.repository.findRecentSucceededRuns(input);
  }

  // 최근 sinceDays~untilDays 윈도우 agentType 별 실행 통계 — Run Retro 회고용.
  async aggregateRunStats(input: {
    sinceDays: number;
    untilDays?: number;
  }): Promise<AgentRunStatRow[]> {
    return await this.repository.aggregateRunStats(input);
  }

  async sweepZombies(input: { olderThanMinutes: number }): Promise<number> {
    // 정리 대상(좀비)을 먼저 식별해 콘솔 이벤트를 낸다 — SSE 로만 갱신되는 라이브 콘솔은
    // snapshot 을 재조회하지 않으므로(부팅 1회 후 SSE), 스윕이 좀비를 FAILED 로 바꿀 때
    // run.finished(FAILED)/state.changed(WAITING) 를 발행해야 "일하는 중" 오표시가 즉시 지워진다.
    // (ConsoleReadService 의 조회 시점 필터는 부팅/재오픈/디버그 경로만 커버한다.)
    // 식별↔정리 사이 극소 race(막 끝난 런 포함 가능)는 해당 런 자체의 finished 이벤트가 곧
    // 덮으므로 무시한다.
    const cutoffMs = Date.now() - input.olderThanMinutes * 60 * 1000;
    const active = await this.repository.findActiveRuns();
    const zombies = active.filter((run) => run.startedAt.getTime() < cutoffMs);

    const count = await this.repository.sweepZombies(input);

    const finishedAt = new Date();
    for (const zombie of zombies) {
      this.consoleEvents?.publish({
        type: 'run.finished',
        run: this.buildConsoleRun(
          zombie.id,
          zombie.agentType as AgentType,
          AgentRunStatus.FAILED,
          zombie.startedAt,
          finishedAt,
        ),
      });
      this.consoleEvents?.publish({
        type: 'state.changed',
        agentType: zombie.agentType,
        state: ConsoleAgentState.WAITING,
      });
    }
    return count;
  }

  // 콘솔 관제 — 현재 진행 중(IN_PROGRESS) 런 전체. deriveAgentState 의 hasActiveRun 입력 조립용.
  async findActiveRuns(): Promise<ActiveRunSnapshot[]> {
    return await this.repository.findActiveRuns();
  }

  // PR 리뷰 루프 — PR 당 리뷰 1회(쿨다운 재시도) 판정 근거. status 기반 재시도 판정은
  // usecase 몫이라 여기서는 repository 위임(최신 1건 사실 조회)만 한다.
  async findLatestSweepReview(
    input: FindLatestSweepReviewQuery,
  ): Promise<LatestSweepReview | null> {
    return await this.repository.findLatestSweepReview(input);
  }

  async aggregateRetryCounts(input: {
    sinceDays: number;
  }): Promise<AgentRetryCountRow[]> {
    return await this.repository.aggregateRetryCounts(input);
  }

  async aggregateSweptCounts(input: {
    sinceDays: number;
  }): Promise<AgentSweptCountRow[]> {
    return await this.repository.aggregateSweptCounts(input);
  }

  // PM-3': 유사 plan 조회. episodic 주입 시 의미검색(임베딩) → agent_run 재조회로 SimilarPlanRow 복원,
  // 미주입 시 기존 FTS('simple') fallback. 한국어는 FTS 매칭이 약해 episodic 경로가 우선.
  async findSimilarPlans(input: {
    query: string;
    agentType: AgentType;
    limit: number;
    excludeRunId?: number;
  }): Promise<SimilarPlanRow[]> {
    if (!this.episodicMemory) {
      return await this.repository.findSimilarPlans({
        ...input,
        agentType: input.agentType as string,
      });
    }

    const hits = await this.episodicMemory.searchRelevant({
      query: input.query,
      kind: 'agent_run',
      agentType: input.agentType as string,
      limit: input.limit,
    });
    const ids = hits
      .map((hit) => hit.agentRunId)
      .filter((id): id is number => id != null && id !== input.excludeRunId);
    if (ids.length === 0) {
      return [];
    }
    const outputs = await this.repository.findSucceededOutputsByIds({
      ids,
      agentType: input.agentType as string,
    });
    const scoreById = new Map(hits.map((hit) => [hit.agentRunId, hit.score]));
    const outputById = new Map(outputs.map((row) => [row.id, row]));
    // episodic score(관련도) 순서 유지하며 재조회로 살아남은 것만 SimilarPlanRow 로 복원.
    return ids
      .map((id) => {
        const found = outputById.get(id);
        if (!found) {
          return null;
        }
        return {
          id: found.id,
          output: found.output,
          endedAt: found.endedAt,
          rank: scoreById.get(id) ?? 0,
        };
      })
      .filter((row): row is SimilarPlanRow => row !== null);
  }

  // V3 phase loop chain audit walk — rootRunId 로부터 parentId chain 의 children 모두 회복.
  // 보안: rootRunId/maxDepth 가 NaN/Infinity 면 빈 배열로 short-circuit (recursive CTE 보호).
  // maxDepth 는 [1, DEFAULT_CHAIN_MAX_DEPTH] 로 clamp — 외부 입력이 비정상적으로 큰 값을 넣어
  // DB recursive 깊이 폭발시키는 DoS 방지 (security-reviewer MEDIUM).
  // Run Retro chain 관측 — 최근 window 의 chain 뿌리 id 목록. 판정/집계는 호출자가 한다.
  async findChainRootsInWindow(input: {
    sinceDays: number;
    limit: number;
  }): Promise<number[]> {
    return await this.repository.findChainRootsInWindow(input);
  }

  async findChainFromRoot(
    rootRunId: number,
    maxDepth = DEFAULT_CHAIN_MAX_DEPTH,
  ): Promise<AgentRunChainNode[]> {
    if (!Number.isFinite(rootRunId) || !Number.isFinite(maxDepth)) {
      return [];
    }
    const clampedDepth = Math.min(
      Math.max(1, Math.trunc(maxDepth)),
      DEFAULT_CHAIN_MAX_DEPTH,
    );
    return this.repository.findChainFromRoot({
      rootRunId,
      maxDepth: clampedDepth,
    });
  }
}
