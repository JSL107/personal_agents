import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { exclusionKey } from '../domain/art-job-exclusion';
import { ART_JOB_SOURCE, ArtJobListing } from '../domain/art-job-feed.type';
import {
  ArtJobPostingRepositoryPort,
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

@Injectable()
export class ArtJobPostingPrismaRepository implements ArtJobPostingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async isEmpty(): Promise<boolean> {
    const found = await this.prisma.artJobPosting.findFirst({
      select: { id: true },
    });
    return found === null;
  }

  async findKnownSourceIds(sourceIds: string[]): Promise<Set<string>> {
    if (sourceIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.artJobPosting.findMany({
      where: { source: ART_JOB_SOURCE, sourceId: { in: sourceIds } },
      select: { sourceId: true },
    });
    return new Set(rows.map((row) => row.sourceId));
  }

  async markNotified({ listing, resolved }: MarkNotifiedInput): Promise<void> {
    const fields = {
      ...toBaseFields(listing),
      gameTitle: resolved.gameTitle,
      imageUrl: resolved.image?.url ?? null,
      imageOrigin: resolved.image?.origin ?? null,
      notifiedAt: new Date(),
      skippedReason: null,
    };
    await this.prisma.artJobPosting.upsert({
      where: {
        source_sourceId: { source: ART_JOB_SOURCE, sourceId: listing.sourceId },
      },
      create: { source: ART_JOB_SOURCE, sourceId: listing.sourceId, ...fields },
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
          source: ART_JOB_SOURCE,
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
      where: { source: ART_JOB_SOURCE, excludedAt: { not: null } },
      select: { company: true, title: true },
    });
    return new Set(rows.map((row) => exclusionKey(row.company, row.title)));
  }

  async findExcludedSourceIds(sourceIds: string[]): Promise<Set<string>> {
    if (sourceIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.artJobPosting.findMany({
      where: {
        source: ART_JOB_SOURCE,
        sourceId: { in: sourceIds },
        excludedAt: { not: null },
      },
      select: { sourceId: true },
    });
    return new Set(rows.map((row) => row.sourceId));
  }

  async setExcluded(sourceId: string, excluded: boolean): Promise<boolean> {
    const found = await this.prisma.artJobPosting.findUnique({
      where: { source_sourceId: { source: ART_JOB_SOURCE, sourceId } },
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
    const excludedRows = await this.prisma.artJobPosting.findMany({
      where: { source: ART_JOB_SOURCE, excludedAt: { not: null } },
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
}
