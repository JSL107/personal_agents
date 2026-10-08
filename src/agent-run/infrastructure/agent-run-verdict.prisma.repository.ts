import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AgentRunVerdictRepositoryPort,
  AgentVerdictCountRow,
  RecordRunVerdictInput,
  RunVerdictRow,
} from '../domain/port/agent-run-verdict.repository.port';
import { getRunVerdictPolarity } from '../domain/run-verdict';

@Injectable()
export class AgentRunVerdictPrismaRepository implements AgentRunVerdictRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async record({
    agentRunId,
    facet,
    verdict,
    slackUserId,
    source,
  }: RecordRunVerdictInput): Promise<void> {
    // 유일 제약만 두고 create 로 넣으면 두 번째 클릭이 실패한다 — 다시 누르면 덮어쓴다.
    // update 에 createdAt 을 싣지 않는 것이 "처음 판정한 시각 유지" 의 전부다.
    await this.prisma.agentRunVerdict.upsert({
      where: {
        agentRunId_facet_slackUserId: { agentRunId, facet, slackUserId },
      },
      create: { agentRunId, facet, verdict, slackUserId, source },
      update: { verdict, source },
    });
  }

  async findByRun(agentRunId: number): Promise<RunVerdictRow[]> {
    return this.prisma.agentRunVerdict.findMany({
      where: { agentRunId },
      select: { facet: true, verdict: true, slackUserId: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // agent_run_verdict 에는 agent_run 관계가 선언돼 있지 않다(스키마를 건드리면 db:push 가 FK 를
  // 만든다). 그래서 조인 대신 두 번 묻는다 — 판정은 사람이 누른 만큼만 쌓여 행 수가 작다.
  // 판정은 실행 뒤에 생기므로 createdAt 하한으로 첫 조회의 폭을 묶을 수 있다.
  async countByAgentType({
    sinceDays,
    untilDays = 0,
  }: {
    sinceDays: number;
    untilDays?: number;
  }): Promise<AgentVerdictCountRow[]> {
    const dayMs = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - sinceDays * dayMs);
    const until = new Date(Date.now() - untilDays * dayMs);
    const verdicts = await this.prisma.agentRunVerdict.findMany({
      where: { createdAt: { gte: since } },
      select: { agentRunId: true, verdict: true },
    });
    if (verdicts.length === 0) {
      return [];
    }
    const runs = await this.prisma.agentRun.findMany({
      where: {
        id: { in: [...new Set(verdicts.map((row) => row.agentRunId))] },
        startedAt: { gte: since, lt: until },
      },
      select: { id: true, agentType: true },
    });
    const agentTypeByRunId = new Map(
      runs.map((run) => [run.id, run.agentType]),
    );
    const counts = new Map<string, AgentVerdictCountRow>();
    for (const { agentRunId, verdict } of verdicts) {
      const agentType = agentTypeByRunId.get(agentRunId);
      if (agentType === undefined) {
        continue;
      }
      const row = counts.get(agentType) ?? {
        agentType,
        total: 0,
        good: 0,
        bad: 0,
      };
      row.total += 1;
      const polarity = getRunVerdictPolarity(verdict);
      if (polarity !== 'neutral') {
        row[polarity] += 1;
      }
      counts.set(agentType, row);
    }
    return [...counts.values()];
  }
}
