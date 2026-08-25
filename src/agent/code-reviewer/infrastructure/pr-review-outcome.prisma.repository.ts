import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { PrReviewOutcomeRepositoryPort } from '../domain/port/pr-review-outcome.repository.port';
import { SaveReviewOutcomeInput } from '../domain/pr-review-outcome.type';

@Injectable()
export class PrReviewOutcomePrismaRepository implements PrReviewOutcomeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveReviewOutcomeInput): Promise<void> {
    await this.prisma.prReviewOutcome.create({ data: input });
  }
}
