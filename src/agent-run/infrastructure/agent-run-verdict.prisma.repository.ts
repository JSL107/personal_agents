import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AgentRunVerdictRepositoryPort,
  RecordRunVerdictInput,
  RunVerdictRow,
} from '../domain/port/agent-run-verdict.repository.port';

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
}
