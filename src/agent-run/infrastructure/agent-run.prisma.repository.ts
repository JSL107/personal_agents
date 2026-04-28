import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AgentType } from '../../model-router/domain/model-router.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRunStatus, EvidenceInput } from '../domain/agent-run.type';
import {
  AgentRunRepositoryPort,
  BeginAgentRunInput,
  FinishAgentRunInput,
  QuotaStatRow,
  QuotaStatsQuery,
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
  }: FinishAgentRunInput): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id },
      data: {
        status,
        modelUsed,
        cliProvider,
        durationMs,
        output: (output ?? null) as unknown as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDays);

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
}
