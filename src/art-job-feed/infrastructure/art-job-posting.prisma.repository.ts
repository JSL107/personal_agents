import { Injectable } from '@nestjs/common';

import {
  PlainDate,
  plainDateToUtcDate,
  utcDateToPlainDate,
} from '../../agent/vacation/domain/plain-date';
import { PrismaService } from '../../prisma/prisma.service';
import { exclusionKey } from '../domain/art-job-exclusion';
import { ArtJobListing } from '../domain/art-job-feed.type';
import {
  ArtJobPostingRef,
  ArtJobPostingRepositoryPort,
  ArtJobReminderPosting,
  InterestedPosting,
  listingKey,
  MarkNotifiedInput,
} from '../domain/port/art-job-posting.repository.port';

const SEED_REASON = 'SEED';

const toBaseFields = (listing: ArtJobListing) => {
  return {
    company: listing.company,
    title: listing.title,
    detailUrl: listing.detailUrl,
  };
};

const toRefWhere = ({ source, sourceId }: ArtJobPostingRef) => {
  return { source, sourceId };
};

// 장부의 source 는 문자열 컬럼이다 — 이 피드가 쓴 값만 들어 있다.
const toListingKey = (row: { source: string; sourceId: string }): string => {
  return listingKey({
    source: row.source as ArtJobPostingRef['source'],
    sourceId: row.sourceId,
  });
};

@Injectable()
export class ArtJobPostingPrismaRepository implements ArtJobPostingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async isEmpty(): Promise<boolean> {
    const found = await this.prisma.artJobPosting.findFirst({
      select: { id: true },
    });
    return found === null;
  }

  async findKnownKeys(listings: ArtJobListing[]): Promise<Set<string>> {
    if (listings.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.artJobPosting.findMany({
      where: {
        OR: listings.map(toRefWhere),
      },
      select: { source: true, sourceId: true },
    });
    return new Set(rows.map(toListingKey));
  }

  async markNotified({
    listing,
    resolved,
    deadlineDate,
  }: MarkNotifiedInput): Promise<void> {
    const fields = {
      ...toBaseFields(listing),
      deadlineDate: deadlineDate ? plainDateToUtcDate(deadlineDate) : null,
      gameTitle: resolved.gameTitle,
      imageUrl: resolved.image?.url ?? null,
      imageOrigin: resolved.image?.origin ?? null,
      notifiedAt: new Date(),
      skippedReason: null,
    };
    await this.prisma.artJobPosting.upsert({
      where: {
        source_sourceId: { source: listing.source, sourceId: listing.sourceId },
      },
      create: { source: listing.source, sourceId: listing.sourceId, ...fields },
      update: fields,
    });
  }

  async markSeeded(listings: ArtJobListing[]): Promise<void> {
    if (listings.length === 0) {
      return;
    }
    await this.prisma.artJobPosting.createMany({
      data: listings.map((listing) => {
        return {
          source: listing.source,
          sourceId: listing.sourceId,
          ...toBaseFields(listing),
          skippedReason: SEED_REASON,
        };
      }),
      skipDuplicates: true,
    });
  }

  async findExcludedKeys(): Promise<Set<string>> {
    const rows = await this.prisma.artJobPosting.findMany({
      where: { excludedAt: { not: null } },
      select: { company: true, title: true },
    });
    return new Set(rows.map((row) => exclusionKey(row.company, row.title)));
  }

  async findExcludedListingKeys(
    refs: ArtJobPostingRef[],
  ): Promise<Set<string>> {
    if (refs.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.artJobPosting.findMany({
      where: { OR: refs.map(toRefWhere), excludedAt: { not: null } },
      select: { source: true, sourceId: true },
    });
    return new Set(rows.map(toListingKey));
  }

  async setExcluded(
    ref: ArtJobPostingRef,
    excluded: boolean,
  ): Promise<boolean> {
    const found = await this.prisma.artJobPosting.findUnique({
      where: { source_sourceId: toRefWhere(ref) },
      select: { id: true, company: true, title: true },
    });
    if (!found) {
      return false;
    }
    if (excluded) {
      await this.prisma.artJobPosting.update({
        where: { id: found.id },
        data: { excludedAt: new Date() },
      });
      return true;
    }
    // 되돌리기는 같은 공고(회사 + 제목) 전부를 푼다. 발송 필터가 그 단위로 거르므로, 같은 제목의
    // 다른 번호가 제외로 남아 있으면 이 행만 풀어도 재등록은 계속 걸러진다.
    const key = exclusionKey(found.company, found.title);
    // 발송 필터(findExcludedKeys)가 소스를 가리지 않으므로 되돌리기도 소스를 가리지 않는다.
    const excludedRows = await this.prisma.artJobPosting.findMany({
      where: { excludedAt: { not: null } },
      select: { id: true, company: true, title: true },
    });
    const ids = excludedRows
      .filter((row) => exclusionKey(row.company, row.title) === key)
      .map((row) => row.id);
    await this.prisma.artJobPosting.updateMany({
      where: { id: { in: ids } },
      data: { excludedAt: null },
    });
    return true;
  }

  async findInterestedListingKeys(
    refs: ArtJobPostingRef[],
  ): Promise<Set<string>> {
    if (refs.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.artJobPosting.findMany({
      where: { OR: refs.map(toRefWhere), interestedAt: { not: null } },
      select: { source: true, sourceId: true },
    });
    return new Set(rows.map(toListingKey));
  }

  async setInterested(
    ref: ArtJobPostingRef,
    interested: boolean,
    userId: string,
  ): Promise<InterestedPosting | null> {
    const found = await this.prisma.artJobPosting.findUnique({
      where: { source_sourceId: toRefWhere(ref) },
      select: { id: true, deadlineDate: true },
    });
    if (!found) {
      return null;
    }
    await this.prisma.artJobPosting.update({
      where: { id: found.id },
      data: interested
        ? { interestedAt: new Date(), interestedBy: userId }
        : { interestedAt: null, interestedBy: null },
    });
    return {
      deadlineDate: found.deadlineDate
        ? utcDateToPlainDate(found.deadlineDate)
        : null,
    };
  }

  async findDueReminders(
    deadline: PlainDate,
    remindedBefore: Date,
  ): Promise<ArtJobReminderPosting[]> {
    return await this.prisma.artJobPosting.findMany({
      where: {
        deadlineDate: plainDateToUtcDate(deadline),
        interestedAt: { not: null },
        excludedAt: null,
        OR: [
          { deadlineRemindedAt: null },
          { deadlineRemindedAt: { lt: remindedBefore } },
        ],
      },
      select: {
        id: true,
        company: true,
        title: true,
        detailUrl: true,
        interestedBy: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async markReminded(ids: number[], at: Date): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.prisma.artJobPosting.updateMany({
      where: { id: { in: ids } },
      data: { deadlineRemindedAt: at },
    });
  }
}
