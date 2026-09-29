import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ApplicabilityStats,
  ExpandableStudyBrief,
  JudgeableStudyBrief,
  JudgedApplyStudyBrief,
  RecentStudyBrief,
  SaveStudyBriefInput,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import {
  APPLICABILITY_VERDICT,
  ApplicabilityJudgement,
} from '../domain/study-applicability.type';
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
    return row ? toExpandableStudyBrief(row) : undefined;
  }

  // 확장 여부와 무관하게 소유자의 가장 최근 브리프 1건. 실증 CLI(scripts/study-diagram.ts) 전용.
  async findLatest(
    ownerUserId: string,
  ): Promise<ExpandableStudyBrief | undefined> {
    const row = await this.prisma.studyBrief.findFirst({
      where: { ownerUserId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toExpandableStudyBrief(row) : undefined;
  }

  async findById(id: number): Promise<ExpandableStudyBrief | undefined> {
    const row = await this.prisma.studyBrief.findUnique({ where: { id } });
    return row ? toExpandableStudyBrief(row) : undefined;
  }

  async findOldestUnjudgedSince(
    ownerUserId: string,
    since: Date,
  ): Promise<JudgeableStudyBrief | undefined> {
    const row = await this.prisma.studyBrief.findFirst({
      where: { ownerUserId, createdAt: { gte: since }, applicability: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        topic: true,
        verdictJson: true,
        reportMd: true,
        sourceUrls: true,
        createdAt: true,
        notionUrl: true,
        studyKeywords: true,
      },
    });
    if (!row) {
      return undefined;
    }
    return {
      ...toExpandableStudyBrief(row),
      keywords: toStringArray(row.studyKeywords),
      notionUrl: row.notionUrl,
    };
  }

  async saveApplicability(
    id: number,
    judgement: ApplicabilityJudgement,
  ): Promise<boolean> {
    const { count } = await this.prisma.studyBrief.updateMany({
      where: { id, applicability: null },
      data: {
        applicability: judgement.verdict,
        applicabilityJson: judgement as unknown as Prisma.InputJsonValue,
      },
    });
    return count > 0;
  }

  async findApplyJudgedSince(
    ownerUserId: string,
    since: Date,
  ): Promise<JudgedApplyStudyBrief[]> {
    const rows = await this.prisma.studyBrief.findMany({
      where: {
        ownerUserId,
        createdAt: { gte: since },
        applicability: APPLICABILITY_VERDICT.APPLY,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        topic: true,
        notionUrl: true,
        applicabilityJson: true,
      },
    });
    return rows.flatMap((row) => {
      const judgement = row.applicabilityJson as ApplicabilityJudgement | null;
      // 카드 본문을 만들 재료(제안)가 없으면 다시 내보낼 수 없다 — 뺀다.
      if (
        judgement?.verdict !== APPLICABILITY_VERDICT.APPLY ||
        !judgement.proposal ||
        !Array.isArray(judgement.citations)
      ) {
        return [];
      }
      return [
        {
          id: row.id,
          topic: row.topic,
          notionUrl: row.notionUrl,
          judgement,
        },
      ];
    });
  }

  async findTopicsByIds(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.studyBrief.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, topic: true },
    });
    return new Map(rows.map((row) => [row.id, row.topic]));
  }

  async countApplicabilitySince(
    since: Date,
    now: Date,
  ): Promise<ApplicabilityStats> {
    const rows = await this.prisma.studyBrief.findMany({
      where: { createdAt: { gte: since } },
      select: { applicability: true, applicabilityJson: true, createdAt: true },
    });
    const expiredBefore = now.getTime() - 48 * 60 * 60 * 1_000;
    const stats: ApplicabilityStats = {
      apply: 0,
      reference: 0,
      notApplicable: 0,
      rawApply: 0,
      downgradeNoValidCitation: 0,
      downgradeNoProposal: 0,
      unjudgedExpired: 0,
    };
    for (const row of rows) {
      if (row.applicability === null) {
        if (row.createdAt.getTime() < expiredBefore) {
          stats.unjudgedExpired += 1;
        }
        continue;
      }
      stats.apply += row.applicability === 'APPLY' ? 1 : 0;
      stats.reference += row.applicability === 'REFERENCE' ? 1 : 0;
      stats.notApplicable += row.applicability === 'NOT_APPLICABLE' ? 1 : 0;
      const json = (row.applicabilityJson ?? {}) as {
        rawVerdict?: unknown;
        downgradeReason?: unknown;
      };
      stats.rawApply += json.rawVerdict === 'APPLY' ? 1 : 0;
      stats.downgradeNoValidCitation +=
        json.downgradeReason === 'NO_VALID_CITATION' ? 1 : 0;
      stats.downgradeNoProposal +=
        json.downgradeReason === 'NO_PROPOSAL' ? 1 : 0;
    }
    return stats;
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
        studyKeywords: input.keywords as Prisma.InputJsonValue,
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

// select 유무와 무관하게 studyBrief 조회 3곳(findOldestUnexpandedSince·findLatest·findById)이
// 공유하는 row → ExpandableStudyBrief 변환. 여기서만 바꾸면 셋 다 같이 바뀐다.
interface StudyBriefRow {
  id: number;
  kind: string;
  topic: string;
  verdictJson: unknown;
  reportMd: string;
  sourceUrls: unknown;
  createdAt: Date;
}

const toExpandableStudyBrief = (row: StudyBriefRow): ExpandableStudyBrief => ({
  id: row.id,
  kind: row.kind as StudyResearchKind,
  topic: row.topic,
  verdict: row.verdictJson as unknown as StudyBriefVerdict,
  reportMd: row.reportMd,
  sourceUrls: toStringArray(row.sourceUrls),
  createdAt: row.createdAt,
});

// sourceUrls 는 Json 컬럼이라 런타임 형태가 타입으로 보장되지 않는다. 문자열만 남긴다 —
// 여기서 걸러내지 않으면 프롬프트에 `[object Object]` 가 출처로 박힌다.
const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
