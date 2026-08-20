import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ExpandableStudyBrief,
  RecentStudyBrief,
  SaveStudyBriefInput,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import { StudyBriefVerdict } from '../domain/study-brief.type';
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

  async findOldestUnexpandedSince(
    ownerUserId: string,
    since: Date,
  ): Promise<ExpandableStudyBrief | undefined> {
    const row = await this.prisma.studyBrief.findFirst({
      where: {
        ownerUserId,
        createdAt: { gte: since },
        blogDraftPageId: null,
      },
      // 오래된 것부터 — 실패해서 남은 브리프가 새 브리프에 밀리지 않게 한다.
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        topic: true,
        verdictJson: true,
        reportMd: true,
        sourceUrls: true,
        createdAt: true,
      },
    });
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      kind: row.kind as StudyResearchKind,
      topic: row.topic,
      verdict: row.verdictJson as unknown as StudyBriefVerdict,
      reportMd: row.reportMd,
      sourceUrls: toStringArray(row.sourceUrls),
      createdAt: row.createdAt,
    };
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

  async markBlogDraftCreated(
    id: number,
    blogDraftPageId: string,
  ): Promise<void> {
    await this.prisma.studyBrief.update({
      where: { id },
      data: { blogDraftPageId },
    });
  }
}

// sourceUrls 는 Json 컬럼이라 런타임 형태가 타입으로 보장되지 않는다. 문자열만 남긴다 —
// 여기서 걸러내지 않으면 프롬프트에 `[object Object]` 가 출처로 박힌다.
const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
