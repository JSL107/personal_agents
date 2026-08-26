import { Inject, Injectable } from '@nestjs/common';

import {
  PR_REVIEW_OUTCOME_REPOSITORY_PORT,
  PrReviewOutcomeRepositoryPort,
} from '../domain/port/pr-review-outcome.repository.port';
import { SaveReviewOutcomeInput } from '../domain/pr-review-outcome.type';

@Injectable()
export class SaveReviewOutcomeUsecase {
  constructor(
    @Inject(PR_REVIEW_OUTCOME_REPOSITORY_PORT)
    private readonly repository: PrReviewOutcomeRepositoryPort,
  ) {}

  async execute(input: SaveReviewOutcomeInput): Promise<void> {
    await this.repository.save(input);
  }
}
