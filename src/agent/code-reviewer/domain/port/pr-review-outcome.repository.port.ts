import {
  PrReviewOutcome,
  SaveReviewOutcomeInput,
} from '../pr-review-outcome.type';

export const PR_REVIEW_OUTCOME_REPOSITORY_PORT = Symbol(
  'PR_REVIEW_OUTCOME_REPOSITORY_PORT',
);

export interface PrReviewOutcomeRepositoryPort {
  save(input: SaveReviewOutcomeInput): Promise<void>;
  findRecentRejected(input: {
    slackUserId: string;
    limit: number;
  }): Promise<PrReviewOutcome[]>;
}
