import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';

import { evaluateContract } from '../../agent-registry/contract-inspector';
import { DomainException } from '../../common/exception/domain.exception';
import { bubbleForActiveRun } from '../../console/application/agent-activity-bubble';
import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { bubbleForState } from '../../console/application/derive-agent-state';
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
  STALE_RUN_THRESHOLD_MINUTES,
  TriggerType,
} from '../domain/agent-run.type';
import {
  ActiveRunSnapshot,
  AGENT_RUN_REPOSITORY_PORT,
  AgentContractScoreRow,
  AgentRetryCountRow,
  AgentRunRepositoryPort,
  AgentRunStatRow,
  AgentSucceededCountRow,
  AgentSweptCountRow,
  CountUnsuccessfulSweepReviewsQuery,
  FailedAgentRunSnapshot,
  FailedRunDetail,
  FindLatestSweepReviewQuery,
  InputSnapshotEquals,
  LatestSweepReview,
  RecentlyFinishedRun,
  SimilarPlanRow,
  SucceededAgentRunSnapshot,
} from '../domain/port/agent-run.repository.port';

// V3 chain (PM → CTO → BE × N → PO_EVAL → CEO) 의 worst-case 가 5-6 단계 — 16 은 사이클
// 안전망 + 미래 확장 여유. 본 상수가 변경되면 chain 회복 결과 크기 (Slack message / DB I/O) 도
// 변동 — production 운영 후 P99 측정 결과 따라 조정 가능. 본 상수가 hard upper bound 도 겸함 —
// caller 가 더 큰 값 넘겨도 service 가 clamp 하여 DoS (recursive CTE 깊이 폭발) 차단.
const DEFAULT_CHAIN_MAX_DEPTH = 16;

// 말풍선 규칙은 `inputSnapshot` 의 키를 읽는다(`#495 리뷰 중` 의 pullNumber 등). execute 가
// 받는 값은 임의의 JSON 이므로, 객체가 아니면(배열·스칼라·null) null 로 접는다 —
// `ActiveRunSnapshot.inputSnapshot` 을 만드는 저장소 경계와 같은 규칙이라, 이벤트로 뜬 문구와
// 다음 스냅샷의 문구가 같은 입력에서 갈리지 않는다.
function toBubbleSnapshot(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

// episodic 인덱스에 적재하지 않는 워커 — output 에 사람이 읽을 서술이 없고 카운트·id·날짜만
// 있는 계측이라, 이 인덱스의 용도(유사 plan 검색·intent few-shot)에 쓸 내용이 없다.
// 게다가 값이 반복되면 문자열까지 같아져 중복만 쌓는다.
//
// 판정은 중복률이 아니라 output 형태로 한다 — 2026-08-31 실측에서 INVEST 는 중복률이 3.4%
// 였는데도 {"marketCountry":"KR","holdingCount":0,...} 로 PAPER_TRADE 와 같은 계측이었다.
// 카운트 값이 매번 조금씩 달랐을 뿐이라, 중복률로 걸렀다면 놓쳤을 것이다.
// 반대로 PAPER_RECOMMEND·SUBCONSCIOUS_GATE 는 계측처럼 보이지만 reason/proposalText 서술을
// 담고 있어 남긴다.
//
// 한 agentType 을 여러 usecase 가 공유하면 제외하지 않는다 — 아래 넷은 전부 cron autopilot
// 전용이라 output 형태가 하나다. VACATION 은 후보였다가 뺐다: 같은 타입을 조회(계측) 외에
// 등록·취소 usecase 가 함께 쓰고 있어, 막으면 사용자 휴가 행위 기록까지 사라진다.
const EPISODIC_EXCLUDED_AGENT_TYPES: ReadonlySet<AgentType> = new Set([
  AgentType.PAPER_TRADE, // {"inspectedCount":6,"priceErrorCount":0,...}
  AgentType.HUMANIZER, // {"humanizedKeys":["retrospective"]}
  AgentType.INVEST, // {"marketCountry":"KR","holdingCount":0,...}
]);

export interface AgentRunExecutionResult<T> {
  result: T;
  modelUsed: string;
  // output 은 JSON 직렬화 가능한 임의 데이터 — domain 객체 그대로 전달 가능.
  // Prisma 저장 경계에서만 InputJsonValue 로 cast.
  output: unknown;
}

export interface AgentRunContext {
  agentRunId: number;
  updateInputSnapshot: (inputSnapshot: unknown) => Promise<void>;
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
export class AgentRunService implements OnApplicationBootstrap {
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

  // 재기동 직후 한 번 쓸어낸다. 좀비의 원인은 코드가 아니라 서버가 내려간 구간이고
  // (실행 중이던 회차는 finish 를 남기지 못한 채 IN_PROGRESS 로 굳는다), 정리는 매시 50분
  // run-sweeper 가 맡는다. 그래서 재기동해도 다음 정각 50분까지 최대 한 시간 동안 원장은
  // "실행 중", 콘솔은 그 워커가 일하는 중으로 보인다 — 2026-09-10 실측: 05:11 에 굳은
  // CODE_REVIEWER 회차가 09시간 뒤 서버가 다시 뜬 시점에도 IN_PROGRESS 로 남아 있었다.
  // 30분 임계는 그대로 쓰므로 방금 시작한 회차는 대상이 아니고, 부팅 시점에는 이 프로세스가
  // 띄운 회차 자체가 없다. 실패해도 부팅을 막지 않는다 — 정리는 정각 스윕이 다시 시도한다.
  async onApplicationBootstrap(): Promise<void> {
    try {
      const swept = await this.sweepZombies({
        olderThanMinutes: STALE_RUN_THRESHOLD_MINUTES,
      });
      if (swept > 0) {
        this.logger.log(
          `부팅 스윕 — ${STALE_RUN_THRESHOLD_MINUTES}분+ IN_PROGRESS ${swept}건을 FAILED 로 정리`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`부팅 스윕 실패 — 정각 스윕에 맡긴다: ${message}`);
    }
  }

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
      bubble: bubbleForActiveRun({
        agentType,
        triggerType,
        inputSnapshot: toBubbleSnapshot(inputSnapshot),
      }),
    });

    // evidence loop 을 try 안에 둬서 recordEvidence 가 throw 하더라도 AgentRun 이 IN_PROGRESS 에 고착되지 않도록 한다.
    try {
      for (const entry of evidence ?? []) {
        await this.repository.recordEvidence({ agentRunId: id, ...entry });
      }

      const execution = await run({
        agentRunId: id,
        updateInputSnapshot: async (nextInputSnapshot: unknown) => {
          if (this.repository.updateInputSnapshot) {
            await this.repository.updateInputSnapshot({
              id,
              inputSnapshot: nextInputSnapshot,
            });
          }
        },
      });

      // 직무 계약 검수 — LLM 을 쓰지 않는 결정론 검사라 비용·지연이 없다.
      // 1단계는 관측 모드다: 위반이 있어도 SUCCEEDED 를 유지하고 기록만 남긴다.
      // 기존 산출물이 새 계약을 얼마나 지키는지 모르는 상태에서 반려를 걸면
      // 매일 도는 cron 이 무더기로 막히기 때문이다.
      const evaluation = evaluateContract(agentType, execution.output);
      const contractViolations = evaluation.violations;
      if (contractViolations.length > 0) {
        this.logger.warn(
          `[계약 위반] ${agentType} run#${id} — ${contractViolations
            .map((violation) => `${violation.rule}(${violation.detail})`)
            .join(', ')}`,
        );
      }

      await this.repository.finish({
        id,
        status: AgentRunStatus.SUCCEEDED,
        modelUsed: execution.modelUsed,
        output: execution.output,
        cliProvider: execution.modelUsed,
        durationMs: Date.now() - startMs,
        contractViolations:
          contractViolations.length > 0 ? contractViolations : undefined,
        // null(검사 항목 0 개)은 그대로 미지정으로 넘긴다 — 1.0 으로 바꾸면 스텁 계약의
        // 무검사 실행이 만점으로 집계돼 평균을 위로 끌어올린다.
        contractScore: evaluation.score ?? undefined,
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
        bubble: bubbleForState(ConsoleAgentState.COMPLETED),
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
      // cause 는 로그와 원장 **양쪽**에 남긴다 — LLM 응답 파싱 실패류는 cause 에만 raw 응답
      // 앞부분이 실려 있다. 로그만 찍던 동안 실제로 원인 추적이 막혔다: 2026-08-14
      // WORK_REVIEWER 와 08-18 BLOG_PUBLISH 의 파싱 실패는 원장에 문구 한 줄만 남아
      // (`"모델 응답을 JSON 으로 파싱하지 못했습니다."`) 모델이 무엇을 돌려줬는지 사후에
      // 복구할 수 없었다. 로그는 프로세스가 재시작하면 사라지고 원장처럼 조회되지도 않는다.
      const causeText = extractCauseMessage(error);
      this.logger.error(
        `AgentRun #${id} (${agentType}) 실패: ${message}${causeText === null ? '' : ` — cause: ${causeText}`}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.repository.finish({
        id,
        status: AgentRunStatus.FAILED,
        // 원인 유형(errorCode)을 message 와 함께 남긴다. 문구만 남기면 소비자가 "초안 내용 탓"
        // 과 "모델 쿼터·타임아웃" 을 가리려고 메시지 패턴을 들고 판정하게 되고, 생산자가 문구를
        // 바꾸는 순간 조용히 오분류된다. 모든 도메인 예외는 DomainException 의 abstract
        // errorCode 를 구현하므로 여기서 한 번 꺼내면 에이전트별 분기 없이 전부 남는다.
        // 기존 소비자는 output.error 만 읽으니 키 추가는 하위호환이다.
        output: {
          error: message,
          ...(error instanceof DomainException
            ? { errorCode: error.errorCode }
            : {}),
          ...(causeText === null ? {} : { cause: causeText }),
        },
        // FAILED 시에도 가능한 만큼 duration 기록 — quota 분석 시 실패 비율도 함께 보임.
        // cliProvider 는 run 콜백이 throw 한 경우 모를 수 있어 옵션 (그 경우 'unknown' 으로 집계됨).
        durationMs: Date.now() - startMs,
      });

      // 콘솔 관제 — 실패 종료 알림(run.finished(FAILED) + FAILED).
      // 실패는 유휴(WAITING)와 구분되도록 전용 FAILED 상태로 발행한다.
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
        state: ConsoleAgentState.FAILED,
        bubble: bubbleForState(ConsoleAgentState.FAILED),
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
    if (EPISODIC_EXCLUDED_AGENT_TYPES.has(agentType)) {
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
    /** `inputSnapshot` 의 한 경로로 조회 단계에서 거른다 — take 가 필터보다 먼저 걸리는 것을 막는다. */
    inputSnapshotEquals?: InputSnapshotEquals;
    sinceDays: number;
    limit: number;
  }): Promise<SucceededAgentRunSnapshot[]> {
    return this.repository.findRecentSucceededRuns(input);
  }

  // 최근 N일간 예외로 끝난 실행 기록. 실패한 회차가 무엇을 입력으로 돌았는지 알아야
  // 같은 입력을 다음 회차에서 피할 수 있다.
  async findRecentFailedRuns(input: {
    agentType: AgentType;
    sinceDays: number;
    limit: number;
  }): Promise<FailedAgentRunSnapshot[]> {
    return this.repository.findRecentFailedRuns(input);
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
    // run.finished(FAILED)/state.changed(FAILED) 를 발행해야 "일하는 중" 오표시가 즉시 지워진다.
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
        state: ConsoleAgentState.FAILED,
        bubble: bubbleForState(ConsoleAgentState.FAILED),
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

  // PR 리뷰 루프 — 짧은 쿨다운 재시도의 24시간 예산 판정 근거. usecase 가 필요할 때만
  // 조회하도록 여기서는 repository 위임(실패/고착 시도 수 조회)만 한다.
  async countUnsuccessfulSweepReviews(
    input: CountUnsuccessfulSweepReviewsQuery,
  ): Promise<number> {
    return await this.repository.countUnsuccessfulSweepReviews(input);
  }

  // 콘솔 관제 — 재접속 스냅샷 복원용. agentType별 최신 종료 런의 결과(성공/실패).
  async findRecentlyFinishedRuns(input: {
    withinMinutes: number;
    since?: Date;
  }): Promise<RecentlyFinishedRun[]> {
    return await this.repository.findRecentlyFinishedRuns(input);
  }

  // 비서실 브리핑 — cutoff 이내 실패 런 전건 + 이유. 반복 실패 판정에 건수가 필요해
  // agentType 별 최신 1건만 주는 findRecentlyFinishedRuns 로는 대체할 수 없다.
  async findFailedRunsSince(input: {
    withinMinutes: number;
    slackUserId?: string;
  }): Promise<FailedRunDetail[]> {
    return await this.repository.findFailedRunsSince(input);
  }

  // 비서실 브리핑 — agentType 별 성공 건수. aggregateRunStats 의 total 은 진행 중인 런까지
  // 포함하므로 "완료" 를 세는 데 쓸 수 없다.
  async aggregateSucceededCounts(input: {
    sinceDays: number;
  }): Promise<AgentSucceededCountRow[]> {
    return await this.repository.aggregateSucceededCounts(input);
  }

  // 콘솔 오피스 서류 더미 — "오늘 자정 이후" 처럼 절대 시각으로 창을 자를 때 쓴다.
  // 롤링 창(sinceDays)으로는 하루가 바뀌어도 어제 새벽 실행이 계속 남아 책상이 안 비워진다.
  async countSucceededSince(input: {
    since: Date;
  }): Promise<AgentSucceededCountRow[]> {
    return await this.repository.countSucceededSince(input);
  }

  // 대표 브리핑 퇴근 정산 — 특정 시각 이후 실패로 끝난 런 총수.
  async countFailedSince(input: { since: Date }): Promise<number> {
    return await this.repository.countFailedSince(input);
  }

  async aggregateContractScores(input: {
    sinceDays: number;
    untilDays?: number;
  }): Promise<AgentContractScoreRow[]> {
    return await this.repository.aggregateContractScores(input);
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

// 원장 상한 — 파싱 실패 경로의 cause 는 `buildJsonParseCauseMessage` 가 raw 응답 앞 300자로
// 이미 자르지만, cause 는 그 경로만 쓰는 필드가 아니다(모델 호출 실패·외부 API 오류도 담는다).
// 상한이 없으면 어느 한 경로가 긴 본문을 실어 보내는 순간 원장 행이 통째로 부풀고, 그 사실은
// 조회할 때까지 드러나지 않는다.
const CAUSE_LEDGER_LIMIT = 1_000;

// DomainException 계열은 파싱 실패의 raw 응답 앞부분을 cause 에만 담는다. 문자열을 돌려주는
// 이유는 소비처가 둘이기 때문이다 — 로그 문장(접미사로 붙는다)과 원장 output.cause.
// tsconfig target 이 ES2022 미만이라 Error.cause 는 타입에 없다.
const extractCauseMessage = (error: unknown): string | null => {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  if (cause instanceof Error) {
    return cause.message.slice(0, CAUSE_LEDGER_LIMIT);
  }
  if (typeof cause === 'string') {
    return cause.slice(0, CAUSE_LEDGER_LIMIT);
  }
  return null;
};
