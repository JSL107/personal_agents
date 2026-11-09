import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReelFormatDecision,
  ReelFormatDecisionInput,
  ReelFormatDecisionRepositoryPort,
} from '../domain/port/reel-format-decision.repository.port';

@Injectable()
export class ReelFormatDecisionPrismaRepository implements ReelFormatDecisionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<ReelFormatDecision[]> {
    const rows = await this.prisma.reelFormatDecision.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows as unknown as ReelFormatDecision[];
  }

  async insert(row: ReelFormatDecisionInput): Promise<boolean> {
    try {
      await this.prisma.reelFormatDecision.create({
        data: {
          ...row,
          championValue: row.championValue,
          challengerValue: row.challengerValue,
          statsJson: row.statsJson as Prisma.InputJsonValue,
          policyAfter: row.policyAfter as Prisma.InputJsonValue,
          aiProposal:
            row.aiProposal == null
              ? Prisma.DbNull
              : (row.aiProposal as Prisma.InputJsonValue),
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
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
