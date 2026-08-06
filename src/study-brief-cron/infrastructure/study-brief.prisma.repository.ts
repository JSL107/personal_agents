import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  RecentStudyBrief,
  SaveStudyBriefInput,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import { StudyResearchKind } from '../domain/study-research.parser';

@Injectable()
export class StudyBriefPrismaRepository implements StudyBriefRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findRecentSince(
    ownerUserId: string,
    since: Date,
  ): Promise<RecentStudyBrief[]> {
    const rows = await this.prisma.studyBrief.findMany({
      where: { ownerUserId, createdAt: { gte: since } },
      select: { kind: true, topic: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      kind: row.kind as StudyResearchKind,
      topic: row.topic,
      createdAt: row.createdAt,
    }));
  }

  async save(input: SaveStudyBriefInput): Promise<{ id: number }> {
    const row = await this.prisma.studyBrief.create({
      data: {
        agentRunId: input.agentRunId,
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        topic: input.topic,
        verdictJson: input.verdict as unknown as Prisma.InputJsonValue,
        reportMd: input.reportMd,
        sourceUrls: input.sourceUrls as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async updateNotionUrl(id: number, notionUrl: string): Promise<void> {
    await this.prisma.studyBrief.update({
      where: { id },
      data: { notionUrl },
    });
  }
}
