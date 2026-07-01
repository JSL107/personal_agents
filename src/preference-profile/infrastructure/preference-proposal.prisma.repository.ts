import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { PreferenceDiff } from '../domain/preference-profile.type';
import {
  CreateProposalInput,
  PreferenceProposalRecord,
  PreferenceProposalRepositoryPort,
} from '../domain/port/preference-proposal.repository.port';

@Injectable()
export class PreferenceProposalPrismaRepository
  implements PreferenceProposalRepositoryPort
{
  constructor(private readonly prisma: PrismaService) {}

  async createPending(input: CreateProposalInput): Promise<number> {
    const created = await this.prisma.preferenceProposal.create({
      data: {
        ownerUserId: input.ownerUserId,
        baseVersion: input.baseVersion,
        diffJson: input.diff as unknown as object,
        rationale: input.rationale,
        slackChannelId: input.slackChannelId,
        slackMessageTs: input.slackMessageTs,
      },
    });
    return created.id;
  }

  async findById(id: number): Promise<PreferenceProposalRecord | null> {
    const found = await this.prisma.preferenceProposal.findUnique({
      where: { id },
    });
    if (!found) {
      return null;
    }
    return {
      id: found.id,
      ownerUserId: found.ownerUserId,
      baseVersion: found.baseVersion,
      diff: found.diffJson as unknown as PreferenceDiff,
      rationale: found.rationale,
      status: found.status,
      createdAt: found.createdAt,
    };
  }

  async markResolved(
    id: number,
    status: 'APPROVED' | 'REJECTED',
  ): Promise<void> {
    await this.prisma.preferenceProposal.update({
      where: { id },
      data: { status, resolvedAt: new Date() },
    });
  }

  async recentDecisions(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<PreferenceProposalRecord[]> {
    const rows = await this.prisma.preferenceProposal.findMany({
      where: {
        ownerUserId,
        createdAt: { gte: new Date(sinceMs) },
        status: { in: ['APPROVED', 'REJECTED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((found) => ({
      id: found.id,
      ownerUserId: found.ownerUserId,
      baseVersion: found.baseVersion,
      diff: found.diffJson as unknown as PreferenceDiff,
      rationale: found.rationale,
      status: found.status,
      createdAt: found.createdAt,
    }));
  }

  async countPendingSince(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<number> {
    return this.prisma.preferenceProposal.count({
      where: {
        ownerUserId,
        status: 'PENDING',
        createdAt: { gte: new Date(sinceMs) },
      },
    });
  }
}
