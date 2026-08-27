import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { NormalizedJobPosting } from '../domain/job-feed.type';
import {
  JobPostingRepositoryPort,
  SaveDetailInput,
  SaveScoreInput,
  StoredJobPosting,
  UpsertOutcome,
} from '../domain/port/job-posting.repository.port';

const SELECT_FIELDS = {
  id: true,
  source: true,
  sourceId: true,
  company: true,
  title: true,
  detailUrl: true,
  skillTags: true,
  rawSkillTags: true,
  minYears: true,
  maxYears: true,
  experienceLevel: true,
  locations: true,
  normalizedKey: true,
  jdText: true,
  matchScore: true,
} as const;

@Injectable()
export class JobPostingPrismaRepository implements JobPostingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(postings: NormalizedJobPosting[]): Promise<UpsertOutcome> {
    let created = 0;
    let updated = 0;
    let contentChanged = 0;
    const now = new Date();

    for (const posting of postings) {
      const found = await this.prisma.jobPosting.findUnique({
        where: {
          source_sourceId: {
            source: posting.source,
            sourceId: posting.sourceId,
          },
        },
        select: { id: true, contentHash: true },
      });

      if (found === null) {
        await this.prisma.jobPosting.create({
          data: { ...posting, lastSeenAt: now },
        });
        created += 1;
        continue;
      }

      // 요건이 바뀌었으면 알림 표식을 되돌려 다음 카드에 다시 올린다.
      const changed = found.contentHash !== posting.contentHash;
      await this.prisma.jobPosting.update({
        where: { id: found.id },
        data: {
          ...posting,
          lastSeenAt: now,
          ...(changed ? { notifiedAt: null } : {}),
        },
      });
      updated += 1;
      if (changed) {
        contentChanged += 1;
      }
    }

    return { created, updated, contentChanged };
  }

  async findScoringTargets(
    profileId: number | null,
  ): Promise<StoredJobPosting[]> {
    return this.prisma.jobPosting.findMany({
      where: {
        closedAt: null,
        // 아직 안 매겼거나, 다른 프로필로 매긴 행만 다시 본다.
        OR: [{ matchScore: null }, { scoredProfileId: { not: profileId } }],
      },
      select: SELECT_FIELDS,
    });
  }

  async saveScore({
    id,
    matchScore,
    scoredProfileId,
  }: SaveScoreInput): Promise<void> {
    await this.prisma.jobPosting.update({
      where: { id },
      data: { matchScore, scoredProfileId, scoredAt: new Date() },
    });
  }

  async findNotifiable(
    threshold: number,
    limit: number,
  ): Promise<StoredJobPosting[]> {
    return this.prisma.jobPosting.findMany({
      where: {
        notifiedAt: null,
        closedAt: null,
        matchScore: { gte: threshold },
      },
      orderBy: [{ matchScore: 'desc' }, { firstSeenAt: 'desc' }],
      take: limit,
      select: SELECT_FIELDS,
    });
  }

  // 조회 후 발송하고 나중에 갱신하면 실행이 겹칠 때 같은 카드가 두 번 나간다.
  // 갱신을 조건부로 걸어 원자적으로 선점한다 — 갱신 행이 0 이면 다른 경로가 가져간 것이다.
  // normalizedKey 로 잠그므로 같은 공고의 다른 소스 행까지 함께 닫힌다.
  async claimForNotification(
    normalizedKey: string,
    now: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.jobPosting.updateMany({
      where: { normalizedKey, notifiedAt: null },
      data: { notifiedAt: now },
    });
    return count > 0;
  }

  async findDetailTargets(
    threshold: number,
    limit: number,
    staleBefore: Date,
  ): Promise<StoredJobPosting[]> {
    return this.prisma.jobPosting.findMany({
      where: {
        closedAt: null,
        matchScore: { gte: threshold },
        OR: [
          { detailFetchedAt: null },
          { detailFetchedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { matchScore: 'desc' },
      take: limit,
      select: SELECT_FIELDS,
    });
  }

  async saveDetail({
    id,
    jdText,
    skillTags,
    rawSkillTags,
  }: SaveDetailInput): Promise<void> {
    await this.prisma.jobPosting.update({
      where: { id },
      data: { jdText, skillTags, rawSkillTags, detailFetchedAt: new Date() },
    });
  }

  async findGapCandidates(
    threshold: number,
    limit: number,
  ): Promise<StoredJobPosting[]> {
    return this.prisma.jobPosting.findMany({
      where: {
        closedAt: null,
        matchScore: { gte: threshold },
        // 이미 분석한 공고는 다시 부르지 않는다. 없으면 매일 같은 공고를 재분석한다.
        gapAgentRunId: null,
        jdText: { not: null },
      },
      orderBy: { matchScore: 'desc' },
      take: limit,
      select: SELECT_FIELDS,
    });
  }

  async saveGapAgentRunId(id: number, agentRunId: number): Promise<void> {
    await this.prisma.jobPosting.update({
      where: { id },
      data: { gapAgentRunId: agentRunId },
    });
  }
}
