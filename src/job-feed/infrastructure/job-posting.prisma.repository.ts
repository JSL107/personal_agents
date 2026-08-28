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

// 수집이 매일 돌므로 이틀 넘게 안 보인 공고는 사라진 것으로 본다.
// 없으면 직군 필터·마감 등으로 이번 수집에서 빠진 옛 행이 DB 에 영원히 남아
// 계속 채점·알림·상세수집·갭분석 대상이 된다 (Task 12 실증에서 발견).
const FRESHNESS_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

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
    // Prisma 의 `not:` 은 `<>` 로 컴파일되는데 SQL 3값 논리상 NULL 행은 걸리지 않는다.
    // scoredProfileId 는 CareerProfile 삭제 시 onDelete: SetNull 로 NULL 이 될 수 있어,
    // 그 경우를 따로 넣지 않으면 점수가 남은 채 영영 재채점 대상에서 빠진다.
    const staleConditions =
      profileId === null
        ? [{ matchScore: null }, { scoredProfileId: { not: null } }]
        : [
            { matchScore: null },
            { scoredProfileId: null },
            { scoredProfileId: { not: profileId } },
          ];
    const freshnessCutoff = new Date(Date.now() - FRESHNESS_WINDOW_MS);

    return this.prisma.jobPosting.findMany({
      where: {
        closedAt: null,
        lastSeenAt: { gte: freshnessCutoff },
        OR: staleConditions,
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
    const freshnessCutoff = new Date(Date.now() - FRESHNESS_WINDOW_MS);

    return this.prisma.jobPosting.findMany({
      where: {
        notifiedAt: null,
        closedAt: null,
        matchScore: { gte: threshold },
        lastSeenAt: { gte: freshnessCutoff },
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
    const freshnessCutoff = new Date(Date.now() - FRESHNESS_WINDOW_MS);

    return this.prisma.jobPosting.findMany({
      where: {
        closedAt: null,
        matchScore: { gte: threshold },
        lastSeenAt: { gte: freshnessCutoff },
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
    const freshnessCutoff = new Date(Date.now() - FRESHNESS_WINDOW_MS);

    return this.prisma.jobPosting.findMany({
      where: {
        closedAt: null,
        matchScore: { gte: threshold },
        lastSeenAt: { gte: freshnessCutoff },
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
