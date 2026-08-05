import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { getKstDayStartAsUtc } from '../../common/util/kst-date.util';
// /search-runs 의 ILIKE 패턴 사용자 입력 escape — `%` / `_` / `\` 를 모두 `\` prefix.
// PostgreSQL 의 LIKE 는 default escape 가 `\` 이라 추가 ESCAPE 절 없이 동작.
const escapeLikeMetaChars = (text: string): string =>
  text.replace(/[%_\\]/g, (char) => `\\${char}`);

// 실패 런의 output 은 `{ error: '모델 호출 실패 (CHATGPT, 362s 소요)' }` 형태로 저장된다
// (usecase 의 실패 경로와 run-sweeper 의 좀비 정리가 같은 형태로 쓴다). 그 외 형태이거나
// 기록이 없으면 비서실 브리핑에 빈칸이 남지 않도록 고정 문구로 대체한다.
export const extractFailureReason = (output: unknown): string => {
  if (typeof output !== 'object' || output === null) {
    return '이유 미기록';
  }
  const { error } = output as { error?: unknown };
  if (typeof error !== 'string' || error.trim() === '') {
    return '이유 미기록';
  }
  return error.trim();
};

import { AgentType } from '../../model-router/domain/model-router.type';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AgentRunChainNode,
  AgentRunStatus,
  EvidenceInput,
} from '../domain/agent-run.type';
import {
  ActiveRunSnapshot,
  AgentRetryCountRow,
  AgentRunRepositoryPort,
  AgentRunStatRow,
  AgentSucceededCountRow,
  AgentSweptCountRow,
  BeginAgentRunInput,
  CountUnsuccessfulSweepReviewsQuery,
  FailedRunDetail,
  FailedRunSnapshot,
  FindLatestSweepReviewQuery,
  FinishAgentRunInput,
  LatestSweepReview,
  PmContextStats,
  QuotaStatRow,
  QuotaStatsQuery,
  RecentlyFinishedRun,
  SearchAgentRunRow,
  SearchAgentRunsQuery,
  SimilarPlanRow,
  SucceededAgentRunSnapshot,
} from '../domain/port/agent-run.repository.port';

@Injectable()
export class AgentRunPrismaRepository implements AgentRunRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async begin({
    agentType,
    triggerType,
    inputSnapshot,
  }: BeginAgentRunInput): Promise<{ id: number }> {
    const record = await this.prisma.agentRun.create({
      data: {
        agentType,
        triggerType,
        status: 'IN_PROGRESS',
        inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    return { id: record.id };
  }

  async finish({
    id,
    status,
    modelUsed,
    output,
    cliProvider,
    durationMs,
    contractViolations,
  }: FinishAgentRunInput): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id },
      data: {
        status,
        modelUsed,
        cliProvider,
        durationMs,
        output: (output ?? null) as unknown as Prisma.InputJsonValue,
        contractViolations: (contractViolations ??
          null) as unknown as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    });
  }

  async updateParentId({
    id,
    parentId,
  }: {
    id: number;
    parentId: number;
  }): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id },
      data: { parentId },
    });
  }

  async recordEvidence({
    agentRunId,
    sourceType,
    sourceId,
    url,
    title,
    excerpt,
    payload,
  }: { agentRunId: number } & EvidenceInput): Promise<void> {
    await this.prisma.evidenceRecord.create({
      data: {
        agentRunId,
        sourceType,
        sourceId,
        url,
        title,
        excerpt,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // 가장 최근에 SUCCEEDED 로 끝난 AgentRun 1건. 전일 plan 참조 / PO Shadow 검토 같은 "직전 실행 컨텍스트" 용.
  // slackUserId 명시 시 inputSnapshot.slackUserId JSON path 매칭 — 사용자 한정 명령용
  // (codex review b6xkjewd2 P2: /po-shadow 가 글로벌 최신 PM run 을 가져와 다른 사용자 plan 검토 방지).
  async findLatestSucceededRun({
    agentType,
    slackUserId,
  }: {
    agentType: AgentType;
    slackUserId?: string;
  }): Promise<SucceededAgentRunSnapshot | null> {
    const where: Prisma.AgentRunWhereInput = {
      agentType,
      status: AgentRunStatus.SUCCEEDED,
    };
    if (slackUserId) {
      where.inputSnapshot = {
        path: ['slackUserId'],
        equals: slackUserId,
      };
    }
    const row = await this.prisma.agentRun.findFirst({
      where,
      orderBy: { endedAt: 'desc' },
      select: { id: true, output: true, endedAt: true },
    });
    if (!row || !row.endedAt) {
      return null;
    }
    return {
      id: row.id,
      output: row.output as unknown,
      endedAt: row.endedAt,
    };
  }

  async findRecentSucceededRuns({
    agentType,
    slackUserId,
    sinceDays,
    limit,
  }: {
    agentType: AgentType;
    slackUserId?: string;
    sinceDays: number;
    limit: number;
  }): Promise<SucceededAgentRunSnapshot[]> {
    const cutoff = getKstDayStartAsUtc(sinceDays - 1);

    const where: Prisma.AgentRunWhereInput = {
      agentType,
      status: AgentRunStatus.SUCCEEDED,
      endedAt: { gte: cutoff },
    };
    if (slackUserId) {
      where.inputSnapshot = {
        path: ['slackUserId'],
        equals: slackUserId,
      };
    }

    const rows = await this.prisma.agentRun.findMany({
      where,
      orderBy: { endedAt: 'desc' },
      take: limit,
      select: { id: true, output: true, endedAt: true },
    });

    return rows
      .filter(
        (row): row is typeof row & { endedAt: Date } => row.endedAt !== null,
      )
      .map((row) => ({
        id: row.id,
        output: row.output as unknown,
        endedAt: row.endedAt,
      }));
  }

  async findById(id: number): Promise<FailedRunSnapshot | null> {
    const row = await this.prisma.agentRun.findUnique({
      where: { id },
      select: { id: true, agentType: true, inputSnapshot: true, status: true },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      agentType: row.agentType,
      inputSnapshot: row.inputSnapshot as unknown,
      status: row.status,
    };
  }

  // PM-3': FTS top-K 유사 plan 조회 — plainto_tsquery 로 free-text → tsquery 변환 (AND 조건).
  async findSimilarPlans({
    query,
    agentType,
    limit,
    excludeRunId,
  }: {
    query: string;
    agentType: string;
    limit: number;
    excludeRunId?: number;
  }): Promise<SimilarPlanRow[]> {
    // plainto_tsquery: free-text → tsquery (공백 = AND). to_tsquery 의 파싱 오류 회피.
    const rows = await this.prisma.$queryRaw<
      Array<{ id: number; output: unknown; ended_at: Date; rank: number }>
    >`
      SELECT
        id,
        output,
        ended_at,
        ts_rank(to_tsvector('simple', COALESCE(output::text, '')), plainto_tsquery('simple', ${query})) AS rank
      FROM agent_run
      WHERE
        agent_type = ${agentType}
        AND status = 'SUCCEEDED'
        AND output IS NOT NULL
        ${excludeRunId != null ? Prisma.sql`AND id != ${excludeRunId}` : Prisma.empty}
        AND to_tsvector('simple', COALESCE(output::text, '')) @@ plainto_tsquery('simple', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      id: r.id,
      output: r.output,
      endedAt: r.ended_at,
      rank: Number(r.rank),
    }));
  }

  // Episodic 의미검색이 준 agentRunId 목록으로 output/endedAt 재조회(SUCCEEDED + agentType 일치).
  // SimilarPlanRow.output(JSON)을 content 대체가 아니라 원본 agent_run 에서 복원하기 위함.
  async findSucceededOutputsByIds({
    ids,
    agentType,
  }: {
    ids: number[];
    agentType: string;
  }): Promise<Array<{ id: number; output: unknown; endedAt: Date }>> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prisma.agentRun.findMany({
      where: {
        id: { in: ids },
        agentType,
        status: 'SUCCEEDED',
        endedAt: { not: null },
      },
      select: { id: true, output: true, endedAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      output: row.output as unknown,
      endedAt: row.endedAt as Date,
    }));
  }

  // /search-runs: SUCCEEDED 본인 run 중 output / inputSnapshot 의 텍스트 표현에 keyword 가 포함된 것
  // 최근순. SQL ILIKE 으로 단순화 — FTS (plainto_tsquery) 는 정확도가 좋지만 짧은 키워드 / 부분 일치에 약함.
  // % 문자는 raw SQL 의 LIKE 와 충돌하므로 호출자가 escape 처리하지 않고 wildcard 로 padding 만 한다.
  // slackUserId 매칭은 inputSnapshot 의 JSON path 로 (codex review b6xkjewd2 P2 — quota / po-shadow 와 동일 정책).
  async searchByKeyword({
    slackUserId,
    keyword,
    limit,
  }: SearchAgentRunsQuery): Promise<SearchAgentRunRow[]> {
    // LIKE meta 문자 (`%` `_` `\`) 는 사용자 입력을 literal 로 취급하기 위해 escape.
    // 미escape 시 사용자가 `/search-runs %` 입력하면 본인 SUCCEEDED run 전체 매칭 — 의도 외 결과 + 경량 DoS.
    const pattern = `%${escapeLikeMetaChars(keyword)}%`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        agent_type: string;
        ended_at: Date;
        output: unknown;
        input_snapshot: unknown;
      }>
    >`
      SELECT
        id,
        agent_type,
        ended_at,
        output,
        input_snapshot
      FROM agent_run
      WHERE
        status = 'SUCCEEDED'
        AND input_snapshot->>'slackUserId' = ${slackUserId}
        AND (
          COALESCE(output::text, '') ILIKE ${pattern}
          OR input_snapshot::text ILIKE ${pattern}
        )
      ORDER BY ended_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      id: r.id,
      agentType: r.agent_type,
      endedAt: r.ended_at,
      output: r.output,
      inputSnapshot: r.input_snapshot,
    }));
  }

  // OPS-1: cliProvider 별로 count + 평균/총 duration 집계 (slackUserId 한정).
  // Prisma groupBy 사용 — JSON path 매칭 (inputSnapshot.slackUserId) + startedAt 범위 필터.
  // cliProvider 가 null 인 row (구버전 / FAILED 시 미기록) 는 'unknown' 으로 합쳐 표기.
  async aggregateQuotaStats({
    slackUserId,
    since,
  }: QuotaStatsQuery): Promise<QuotaStatRow[]> {
    const grouped = await this.prisma.agentRun.groupBy({
      by: ['cliProvider'],
      where: {
        startedAt: { gte: since },
        inputSnapshot: { path: ['slackUserId'], equals: slackUserId },
      },
      _count: { _all: true },
      _sum: { durationMs: true },
      _avg: { durationMs: true },
    });
    return grouped.map((row) => ({
      cliProvider: row.cliProvider ?? 'unknown',
      count: row._count._all,
      totalDurationMs: row._sum.durationMs ?? 0,
      avgDurationMs: Math.round(row._avg.durationMs ?? 0),
    }));
  }

  // Run Retro — agentType 별 total/_avg(1쿼리) + FAILED count(1쿼리) → JS 병합.
  // 윈도우: [now - sinceDays, now - untilDays). untilDays 기본 0 = now(하위호환).
  async aggregateRunStats({
    sinceDays,
    untilDays = 0,
  }: {
    sinceDays: number;
    untilDays?: number;
  }): Promise<AgentRunStatRow[]> {
    const dayMs = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - sinceDays * dayMs);
    const until = new Date(Date.now() - untilDays * dayMs);
    const totals = await this.prisma.agentRun.groupBy({
      by: ['agentType'],
      where: { startedAt: { gte: since, lt: until } },
      _count: { _all: true },
      _avg: { durationMs: true },
    });
    const failures = await this.prisma.agentRun.groupBy({
      by: ['agentType'],
      where: { startedAt: { gte: since, lt: until }, status: 'FAILED' },
      _count: { _all: true },
    });
    const failedByType = new Map(
      failures.map((row) => [row.agentType, row._count._all]),
    );
    return totals.map((row) => {
      const total = row._count._all;
      const failed = failedByType.get(row.agentType) ?? 0;
      return {
        agentType: row.agentType,
        total,
        failed,
        failRate: total > 0 ? failed / total : 0,
        avgDurationMs: Math.round(row._avg.durationMs ?? 0),
      };
    });
  }

  // Run Retro chain 관측 — 최근 window 의 chain 뿌리 id 목록.
  // 조건: 자신은 부모 없음(parentId null = 계보의 뿌리) + 다른 run 이 자신을 부모로 참조(children some).
  // 기존 @@index([parentId]) 를 그대로 쓰므로 스키마 변경이 없다. take 로 스캔 상한을 둔다.
  async findChainRootsInWindow({
    sinceDays,
    limit,
  }: {
    sinceDays: number;
    limit: number;
  }): Promise<number[]> {
    const dayMs = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - sinceDays * dayMs);
    const roots = await this.prisma.agentRun.findMany({
      where: {
        parentId: null,
        startedAt: { gte: since },
        children: { some: {} },
      },
      select: { id: true },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return roots.map((row) => row.id);
  }

  // 콘솔 관제 — 현재 IN_PROGRESS 인 런 전체를 최신 시작순으로 조회. 읽기 전용.
  async findActiveRuns(): Promise<ActiveRunSnapshot[]> {
    const rows = await this.prisma.agentRun.findMany({
      where: { status: AgentRunStatus.IN_PROGRESS },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        agentType: true,
        status: true,
        parentId: true,
        startedAt: true,
        endedAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      agentType: row.agentType,
      status: row.status,
      parentId: row.parentId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    }));
  }

  // PR 리뷰 루프 — PR 당 리뷰 1회(쿨다운 재시도) 판정 근거. inputSnapshot.prRef 는
  // ReviewPullRequestUsecase 가 항상 채우는 JSON 필드(JSON path 필터, 인덱스 없음)라
  // startedAt 하한으로 스캔 범위를 제한한다. status 판정(SUCCEEDED/FAILED/쿨다운)은
  // usecase 몫이므로 여기서는 최신 1건의 사실(status/startedAt/dryRun)만 반환한다.
  async findLatestSweepReview({
    prRef,
    sinceDays,
  }: FindLatestSweepReviewQuery): Promise<LatestSweepReview | null> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const row = await this.prisma.agentRun.findFirst({
      where: {
        triggerType: 'PR_REVIEW_SWEEP',
        startedAt: { gte: since },
        inputSnapshot: { path: ['prRef'], equals: prRef },
      },
      orderBy: { startedAt: 'desc' },
      select: { status: true, startedAt: true, inputSnapshot: true },
    });
    if (!row) {
      return null;
    }
    // inputSnapshot 은 임의 JSON — dryRun 이 실제 true 일 때만 연습 모드로 본다(누락·타입
    // 불일치는 전부 false = 실게시로 간주해, 판정이 재리뷰 쪽으로 새지 않게 한다).
    const snapshot = row.inputSnapshot as { dryRun?: unknown } | null;
    return {
      status: row.status,
      startedAt: row.startedAt,
      dryRun: snapshot?.dryRun === true,
    };
  }

  // PR 리뷰 스윕 — 짧아진 쿨다운이 실패 무한 루프를 되살리지 않도록 최근 실패/고착 시도 수를 센다.
  // inputSnapshot.prRef JSON path 는 인덱스가 없으므로 호출자가 retry 직전에만 이 조회를 사용한다.
  async countUnsuccessfulSweepReviews({
    prRef,
    sinceHours,
  }: CountUnsuccessfulSweepReviewsQuery): Promise<number> {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    return await this.prisma.agentRun.count({
      where: {
        triggerType: 'PR_REVIEW_SWEEP',
        status: { not: AgentRunStatus.SUCCEEDED },
        startedAt: { gte: since },
        inputSnapshot: { path: ['prRef'], equals: prRef },
      },
    });
  }

  // 콘솔 관제 — agentType별 최신 종료 런을 distinct(=DISTINCT ON)로 1건씩 뽑아,
  // cutoff 이후 종료된 agentType의 결과(성공/실패)를 반환한다. 재시작으로 결과가 뒤집히면
  // 최신 것만 남으므로 "실패 후 성공" 은 SUCCEEDED 가 된다.
  async findRecentlyFinishedRuns({
    withinMinutes,
  }: {
    withinMinutes: number;
  }): Promise<RecentlyFinishedRun[]> {
    const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000);
    // cutoff 이후 종료된 런만 DB 에서 좁혀 distinct — 누적 이력을 매 스냅샷마다 전수 스캔/정렬하지 않는다.
    // cutoff 범위의 최신 종료 = 전체 최신 종료와 동일(cutoff 밖 런이 최신이면 그 agentType 은 어차피 제외)이라
    // 결과는 애플리케이션 필터와 같다.
    const latestPerAgent = await this.prisma.agentRun.findMany({
      where: { endedAt: { gte: cutoff } },
      orderBy: [{ agentType: 'asc' }, { endedAt: 'desc' }],
      distinct: ['agentType'],
      select: { agentType: true, status: true, id: true },
    });
    // 종료 상태는 SUCCEEDED/FAILED 둘뿐이지만, endedAt 이 채워진 IN_PROGRESS 행이 섞이면
    // 화면이 완료로 오표시된다. 두 값만 통과시켜 그 경로를 막는다.
    return latestPerAgent.flatMap((row): RecentlyFinishedRun[] => {
      if (row.status === AgentRunStatus.SUCCEEDED) {
        return [
          { agentType: row.agentType, status: 'SUCCEEDED', runId: row.id },
        ];
      }
      if (row.status === AgentRunStatus.FAILED) {
        return [{ agentType: row.agentType, status: 'FAILED', runId: row.id }];
      }
      return [];
    });
  }

  async aggregateSucceededCounts({
    sinceDays,
  }: {
    sinceDays: number;
  }): Promise<AgentSucceededCountRow[]> {
    return await this.countSucceededSince({
      since: new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000),
    });
  }

  async countSucceededSince({
    since,
  }: {
    since: Date;
  }): Promise<AgentSucceededCountRow[]> {
    const rows = await this.prisma.agentRun.groupBy({
      by: ['agentType'],
      where: {
        // 시작이 아니라 **완료** 시각으로 자른다. 비서실이 "지난 24시간에 완료된 것" 을
        // 보고하는 데다, 같은 보고의 실패 집계(findFailedRunsSince)도 endedAt 기준이라
        // 시작 시각으로 자르면 두 숫자의 기준이 어긋난다. 창 직전에 시작해 창 안에서
        // 끝난 실행(느린 LLM 호출은 흔하다)이 완료에서 통째로 빠지는 문제도 같이 사라진다.
        endedAt: { gte: since },
        status: AgentRunStatus.SUCCEEDED,
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      agentType: row.agentType,
      succeeded: row._count._all,
    }));
  }

  async findFailedRunsSince({
    withinMinutes,
  }: {
    withinMinutes: number;
  }): Promise<FailedRunDetail[]> {
    const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000);
    const rows = await this.prisma.agentRun.findMany({
      where: { status: AgentRunStatus.FAILED, endedAt: { gte: cutoff } },
      orderBy: { endedAt: 'desc' },
      select: { agentType: true, output: true, endedAt: true },
    });
    return rows.map((row) => ({
      agentType: row.agentType,
      reason: extractFailureReason(row.output),
      // where 절이 endedAt >= cutoff 로 좁혔으니 null 이 나올 수 없다. 타입만 좁힌다.
      endedAt: row.endedAt ?? cutoff,
    }));
  }

  async sweepZombies({
    olderThanMinutes,
  }: {
    olderThanMinutes: number;
  }): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const result = await this.prisma.agentRun.updateMany({
      where: { status: 'IN_PROGRESS', startedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        output: { error: 'swept: stale IN_PROGRESS' },
        endedAt: new Date(),
      },
    });
    return result.count;
  }

  async aggregateRetryCounts({
    sinceDays,
  }: {
    sinceDays: number;
  }): Promise<AgentRetryCountRow[]> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.agentRun.groupBy({
      by: ['agentType'],
      where: { startedAt: { gte: since }, triggerType: 'FAILURE_REPLAY' },
      _count: { _all: true },
    });
    return grouped.map((row) => ({
      agentType: row.agentType,
      retries: row._count._all,
    }));
  }

  async aggregateSweptCounts({
    sinceDays,
  }: {
    sinceDays: number;
  }): Promise<AgentSweptCountRow[]> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.agentRun.groupBy({
      by: ['agentType'],
      where: {
        startedAt: { gte: since },
        status: 'FAILED',
        output: { path: ['error'], string_starts_with: 'swept:' },
      },
      _count: { _all: true },
    });
    return grouped.map((row) => ({
      agentType: row.agentType,
      swept: row._count._all,
    }));
  }

  // /quota: PM agent_run.input_snapshot 의 inboxItemCount / similarPlanCount 누적.
  // OPS-3 / PM-3' 가 실제로 plan 컨텍스트로 주입됐는지 사용자가 직접 확인할 수 있게 한다.
  // input_snapshot 은 Json 타입 — JSONB 키 추출(->>) 후 ::int cast. 키 자체가 없는 구버전 row 는 NULL → 0 으로 처리.
  async aggregatePmContextStats({
    slackUserId,
    since,
  }: QuotaStatsQuery): Promise<PmContextStats> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        pm_run_count: bigint;
        total_inbox_items: bigint | null;
        pm_runs_with_inbox: bigint;
        total_similar_plans: bigint | null;
        pm_runs_with_similar: bigint;
      }>
    >`
      SELECT
        COUNT(*)::bigint AS pm_run_count,
        COALESCE(SUM(COALESCE((input_snapshot->>'inboxItemCount')::int, 0)), 0)::bigint AS total_inbox_items,
        COUNT(*) FILTER (WHERE COALESCE((input_snapshot->>'inboxItemCount')::int, 0) > 0)::bigint AS pm_runs_with_inbox,
        COALESCE(SUM(COALESCE((input_snapshot->>'similarPlanCount')::int, 0)), 0)::bigint AS total_similar_plans,
        COUNT(*) FILTER (WHERE COALESCE((input_snapshot->>'similarPlanCount')::int, 0) > 0)::bigint AS pm_runs_with_similar
      FROM agent_run
      WHERE agent_type = 'PM'
        AND started_at >= ${since}
        AND input_snapshot->>'slackUserId' = ${slackUserId}
    `;

    const row = rows[0];
    if (!row) {
      return {
        pmRunCount: 0,
        totalInboxItems: 0,
        pmRunsWithInbox: 0,
        totalSimilarPlans: 0,
        pmRunsWithSimilar: 0,
      };
    }
    return {
      pmRunCount: Number(row.pm_run_count),
      totalInboxItems: Number(row.total_inbox_items ?? 0n),
      pmRunsWithInbox: Number(row.pm_runs_with_inbox),
      totalSimilarPlans: Number(row.total_similar_plans ?? 0n),
      pmRunsWithSimilar: Number(row.pm_runs_with_similar),
    };
  }

  // V3 phase loop chain audit — rootRunId 로부터 parent_id 로 연결된 children 을 recursive CTE
  // 로 회복. depth 가드로 사이클/병리적 깊이 방어 (정상 schema 에서는 사이클 불가능, 안전망).
  // 정렬: depth 우선 → 같은 depth 내 id 순. Slack chain 메시지 / /retry-run chain replay /
  // CEO drift R&D 입력의 공통 회복 단위.
  async findChainFromRoot({
    rootRunId,
    maxDepth,
  }: {
    rootRunId: number;
    maxDepth: number;
  }): Promise<AgentRunChainNode[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        parent_id: number | null;
        agent_type: string;
        status: string;
        started_at: Date;
        ended_at: Date | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE chain AS (
        SELECT
          id,
          parent_id,
          agent_type,
          status,
          started_at,
          ended_at,
          0 AS depth
        FROM agent_run
        WHERE id = ${rootRunId}

        UNION ALL

        SELECT
          a.id,
          a.parent_id,
          a.agent_type,
          a.status,
          a.started_at,
          a.ended_at,
          c.depth + 1 AS depth
        FROM agent_run a
        JOIN chain c ON a.parent_id = c.id
        WHERE c.depth < ${maxDepth}
      )
      SELECT id, parent_id, agent_type, status, started_at, ended_at, depth
      FROM chain
      ORDER BY depth ASC, id ASC
    `;

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      agentType: row.agent_type,
      status: row.status as AgentRunStatus,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      depth: Number(row.depth),
    }));
  }
}
