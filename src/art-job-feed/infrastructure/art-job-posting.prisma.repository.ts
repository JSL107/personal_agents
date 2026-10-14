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
    const result = await this.prisma.artJobPosting.updateMany({
      where: { source: ART_JOB_SOURCE, sourceId },
      data: { excludedAt: excluded ? new Date() : null },
    });
    return result.count > 0;
  }
}
