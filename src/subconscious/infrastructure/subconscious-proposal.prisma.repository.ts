import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProposalInput,
  ProposalStatus,
  SubconsciousProposalRecord,
  SubconsciousProposalRepository,
} from '../domain/port/subconscious-proposal.repository.port';

@Injectable()
export class SubconsciousProposalPrismaRepository implements SubconsciousProposalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateProposalInput,
  ): Promise<SubconsciousProposalRecord> {
    const row = await this.prisma.subconsciousProposal.create({
      data: {
        ownerUserId: input.ownerUserId,
        sourceId: input.sourceId,
        changeKey: input.changeKey,
        suggestedAgentType: input.suggestedAgentType,
        proposalText: input.proposalText,
        contextJson: input.contextJson as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });
    return toDomain(row);
  }

  async findById(id: number): Promise<SubconsciousProposalRecord | null> {
    const found = await this.prisma.subconsciousProposal.findUnique({
      where: { id },
    });
    return found ? toDomain(found) : null;
  }

  async markStatus(
    id: number,
    status: Exclude<ProposalStatus, 'PENDING'>,
    resolvedAt?: Date,
  ): Promise<void> {
    await this.prisma.subconsciousProposal.update({
      where: { id },
      data: {
        status,
        resolvedAt: resolvedAt ?? new Date(),
      },
    });
  }

  async transitionFromPending(
    id: number,
    toStatus: Exclude<ProposalStatus, 'PENDING'>,
    resolvedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.subconsciousProposal.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: toStatus, resolvedAt },
    });
    return result.count === 1;
  }

  async attachSlackMessage(
    id: number,
    channelId: string,
    messageTs: string,
  ): Promise<void> {
    await this.prisma.subconsciousProposal.update({
      where: { id },
      data: {
        slackChannelId: channelId,
        slackMessageTs: messageTs,
      },
    });
  }
}

const toDomain = (row: {
  id: number;
  ownerUserId: string;
  sourceId: string;
  changeKey: string;
  suggestedAgentType: string;
  proposalText: string;
  contextJson: Prisma.JsonValue;
  status: string;
  slackChannelId: string | null;
  slackMessageTs: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}): SubconsciousProposalRecord => ({
  id: row.id,
  ownerUserId: row.ownerUserId,
  sourceId: row.sourceId,
  changeKey: row.changeKey,
  suggestedAgentType: row.suggestedAgentType,
  proposalText: row.proposalText,
  contextJson: row.contextJson as unknown,
  status: row.status as ProposalStatus,
  slackChannelId: row.slackChannelId,
  slackMessageTs: row.slackMessageTs,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
});
