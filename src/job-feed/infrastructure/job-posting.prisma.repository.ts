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
        select: { id: true, contentHash: true, detailFetchedAt: true },
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
      // 상세를 이미 받은 행(원티드처럼 목록에 스킬이 없는 소스)은 saveDetail 이 채운
      // skillTags·rawSkillTags 를 다음 수집의 목록 값(원티드는 항상 빈 배열)으로
      // 되돌리면 안 된다 — 되돌리면 스킬이 다시 비어 findDetailTargets 데드락이
      // 재발한다. 목록이 갱신할 나머지 필드만 명시적으로 나열한다(raw 를 그대로
      // spread 하지 않는 위 normalize() 의 이유와 같다 — 여분 필드가 조용히 섞이면 안 된다).
      const listOnlyFields = {
        source: posting.source,
        sourceId: posting.sourceId,
        company: posting.company,
        companyKey: posting.companyKey,
        title: posting.title,
        detailUrl: posting.detailUrl,
        minYears: posting.minYears,
        maxYears: posting.maxYears,
        yearsSource: posting.yearsSource,
        rawJobLevel: posting.rawJobLevel,
        experienceLevel: posting.experienceLevel,
        locations: posting.locations,
        rawLocations: posting.rawLocations,
        normalizedKey: posting.normalizedKey,
        contentHash: posting.contentHash,
      };
      const updateData =
        found.detailFetchedAt === null
          ? {
              ...listOnlyFields,
              skillTags: posting.skillTags,
              rawSkillTags: posting.rawSkillTags,
            }
          : listOnlyFields;

      await this.prisma.jobPosting.update({
        where: { id: found.id },
        data: {
          ...updateData,
          lastSeenAt: now,
          // 요건(기술·연차·지역 등)이 바뀌면 점수도 무효화해야 한다. scoredProfileId 를
          // 그대로 두면, 현재 프로필과 값이 같을 때 findScoringTargets 가 이 행을 재채점
          // 대상으로 다시 잡지 못해 변경 전 점수(matchScore)가 그대로 남는다 — 바뀐
          // 요건과 무관하게 알림에 포함되거나 빠지는 결과가 된다.
          ...(changed
            ? { notifiedAt: null, scoredProfileId: null, scoredAt: null }
            : {}),
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
        lastSeenAt: { gte: freshnessCutoff },
        AND: [
          {
            OR: [
              { matchScore: { gte: threshold } },
              // 목록에 스킬이 없는 소스(원티드)는 상세를 받기 전엔 점수가 오를 수 없다.
              // 점수 조건만 두면 상세를 못 받고 → 스킬이 안 채워지고 → 점수가 안 오르는
              // 데드락이 된다(Task 17 이후 최종 리뷰 Critical 1).
              { skillTags: { isEmpty: true } },
            ],
          },
          {
            OR: [
              { detailFetchedAt: null },
              { detailFetchedAt: { lt: staleBefore } },
            ],
          },
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
      data: {
        jdText,
        skillTags,
        rawSkillTags,
        detailFetchedAt: new Date(),
        // 점수는 상세로 채워진 새 스킬 기준으로 다시 매겨야 한다. 형제 함수
        // saveSkillTags 와 같은 이유로 채점 표식을 지워 다음 채점에서 다시
        // 걸리게 한다 — 지우지 않으면 findScoringTargets 가 재채점 대상으로
        // 잡지 못해 원티드가 상세를 받고도 옛 점수(65)에 영원히 머문다.
        scoredProfileId: null,
        scoredAt: null,
      },
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
        // jdText: { not: null } 만으로는 매퍼가 본문 필드가 전부 비었을 때 만드는
        // 빈 문자열('')을 걸러내지 못한다(findScoringTargets 의 { not: profileId } 와
        // 같은 계열의 SQL 3값 논리 함정 — `<>` 비교는 NULL 만 배제하고 빈 문자열은
        // 그대로 통과시킨다). 빈 JD 가 여기를 통과하면 AnalyzeJdGapUsecase 가 예외를
        // 던져 gapAgentRunId 가 계속 비고, 같은 공고를 매일 재시도하게 된다.
        NOT: [{ jdText: null }, { jdText: '' }],
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

  // 신선도(lastSeenAt) 조건을 일부러 넣지 않는다 — 재파생은 사전 갱신 효과를
  // 과거 행까지 소급 적용하는 것이 목적이라, 최근에 못 본 행까지 포함해야 한다.
  async findAllForReprocess(): Promise<StoredJobPosting[]> {
    return this.prisma.jobPosting.findMany({
      where: { closedAt: null },
      select: SELECT_FIELDS,
    });
  }

  async saveSkillTags(id: number, skillTags: string[]): Promise<void> {
    // 점수는 새 태그 기준으로 다시 매겨야 하므로 채점 표식을 지워 다음 채점에서
    // 다시 걸리게 한다.
    await this.prisma.jobPosting.update({
      where: { id },
      data: { skillTags, scoredProfileId: null, scoredAt: null },
    });
  }

  async findLastCollectedAt(): Promise<Date | null> {
    const latest = await this.prisma.jobPosting.aggregate({
      _max: { lastSeenAt: true },
    });
    return latest._max.lastSeenAt ?? null;
  }
}
