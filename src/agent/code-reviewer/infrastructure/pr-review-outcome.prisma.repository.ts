import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { PrReviewOutcomeRepositoryPort } from '../domain/port/pr-review-outcome.repository.port';
import {
  PrReviewOutcome,
  SaveReviewOutcomeInput,
} from '../domain/pr-review-outcome.type';

@Injectable()
export class PrReviewOutcomePrismaRepository implements PrReviewOutcomeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveReviewOutcomeInput): Promise<void> {
    await this.prisma.prReviewOutcome.create({ data: input });
  }

  async findRecentRejected({
    slackUserId,
    limit,
  }: {
    slackUserId: string;
    limit: number;
  }): Promise<PrReviewOutcome[]> {
    const rows = await this.prisma.prReviewOutcome.findMany({
      where: { slackUserId, accepted: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      agentRunId: r.agentRunId,
      slackUserId: r.slackUserId,
      accepted: r.accepted,
      comment: r.comment,
      createdAt: r.createdAt,
    }));
  }
}
