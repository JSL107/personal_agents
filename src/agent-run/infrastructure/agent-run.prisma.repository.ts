import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AgentType } from '../../model-router/domain/model-router.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRunStatus, EvidenceInput } from '../domain/agent-run.type';
import {
  AgentRunRepositoryPort,
  BeginAgentRunInput,
  FinishAgentRunInput,
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
        inputSnapshot: inputSnapshot as Prisma.InputJsonValue,
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
  }: FinishAgentRunInput): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id },
      data: {
        status,
        modelUsed,
        output: (output ?? null) as Prisma.InputJsonValue,
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
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  // 가장 최근에 SUCCEEDED 로 끝난 AgentRun 1건. 전일 plan 참조 같은 "직전 실행 컨텍스트" 가 필요한 유스케이스용.
  async findLatestSucceededRun({
    agentType,
  }: {
    agentType: AgentType;
  }): Promise<SucceededAgentRunSnapshot | null> {
    const row = await this.prisma.agentRun.findFirst({
      where: { agentType, status: AgentRunStatus.SUCCEEDED },
      orderBy: { endedAt: 'desc' },
      select: { id: true, output: true, endedAt: true },
    });
    if (!row || !row.endedAt) {
      return null;
    }
    return {
      id: row.id,
      output: row.output as Record<string, unknown> | null,
      endedAt: row.endedAt,
    };
  }
}
