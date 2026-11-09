import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { DecisionStatsRecord } from '../domain/format-decision.policy';
import { ReelFormatLedgerCorruptedException } from '../domain/instagram.exception';
import {
  ReelFormatDecision,
  ReelFormatDecisionInput,
  ReelFormatDecisionRepositoryPort,
} from '../domain/port/reel-format-decision.repository.port';
import { toReelFormatDecision } from './reel-format-decision.mapper';

@Injectable()
export class ReelFormatDecisionPrismaRepository implements ReelFormatDecisionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<ReelFormatDecision[]> {
    const rows = await this.prisma.reelFormatDecision.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const decisions: ReelFormatDecision[] = [];
    const corruptedIds: string[] = [];
    for (const row of rows) {
      try {
        decisions.push(toReelFormatDecision(row));
      } catch (error) {
        if (!(error instanceof ReelFormatLedgerCorruptedException)) {
          throw error;
        }
        corruptedIds.push(...error.ids);
      }
    }
    if (corruptedIds.length > 0) {
      throw new ReelFormatLedgerCorruptedException(corruptedIds);
    }
    return decisions;
  }

  async insert(
    row: ReelFormatDecisionInput,
  ): Promise<ReelFormatDecision | null> {
    try {
      const created = await this.prisma.reelFormatDecision.create({
        data: {
          ...row,
          statsJson: toPrismaStats(row.statsJson),
          policyAfter: row.policyAfter,
          aiProposal:
            row.aiProposal === null ? Prisma.DbNull : { ...row.aiProposal },
        },
      });
      return toReelFormatDecision(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  async markReported(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.prisma.reelFormatDecision.updateMany({
      where: { id: { in: ids }, reportedAt: null },
      data: { reportedAt: new Date() },
    });
  }
}

const toPrismaStats = (stats: DecisionStatsRecord): Prisma.InputJsonValue => {
  if (stats.kind === 'guard') {
    return {
      ...stats,
      samples: stats.samples.map((sample) => ({ ...sample })),
    };
  }
  return {
    ...stats,
    excluded: { ...stats.excluded },
    publishRates: { ...stats.publishRates },
    samples: stats.samples.map((sample) => ({ ...sample })),
  };
};
