import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  PortfolioSyncCardAdoptionRow,
  PortfolioSyncCardRepositoryPort,
  PortfolioSyncCardRow,
  PortfolioSyncCardStatus,
  PortfolioSyncCardWrite,
} from '../domain/port/portfolio-sync-card.repository.port';

@Injectable()
export class PortfolioSyncCardPrismaRepository implements PortfolioSyncCardRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PortfolioSyncCardRow[]> {
    const rows = await this.prisma.portfolioSyncCard.findMany({
      orderBy: { slug: 'asc' },
    });
    return rows.map((row) => ({
      slug: row.slug,
      siteProjectId: row.siteProjectId,
      repo: row.repo,
      topicIndex: row.topicIndex,
      memberPrs: row.memberPrs,
      coverOf: row.coverOf,
      status: row.status as PortfolioSyncCardStatus,
      inheritPublished: row.inheritPublished,
      lastSentSortOrder: row.lastSentSortOrder,
    }));
  }

  async upsertActive(input: PortfolioSyncCardWrite): Promise<void> {
    const sortOrderUpdate =
      input.lastSentSortOrder === undefined
        ? {}
        : { lastSentSortOrder: input.lastSentSortOrder };
    await this.prisma.portfolioSyncCard.upsert({
      where: { slug: input.slug },
      create: {
        slug: input.slug,
        siteProjectId: input.siteProjectId,
        repo: input.repo,
        topicIndex: input.topicIndex,
        memberPrs: input.memberPrs,
        coverOf: input.coverOf,
        status: 'ACTIVE',
        lastSentSortOrder: input.lastSentSortOrder ?? null,
      },
      update: {
        siteProjectId: input.siteProjectId,
        repo: input.repo,
        topicIndex: input.topicIndex,
        memberPrs: input.memberPrs,
        coverOf: input.coverOf,
        status: 'ACTIVE',
        ...sortOrderUpdate,
      },
    });
  }

  async clearCoverOf(slugs: string[]): Promise<void> {
    if (slugs.length === 0) {
      return;
    }
    await this.prisma.portfolioSyncCard.updateMany({
      where: { slug: { in: slugs } },
      data: { coverOf: null },
    });
  }

  async createMany(rows: PortfolioSyncCardAdoptionRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.prisma.portfolioSyncCard.createMany({
      data: rows.map((row) => ({
        ...row,
        status: 'ACTIVE',
      })),
    });
  }
}
