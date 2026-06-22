import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  EPISODIC_MEMORY_PORT,
  EpisodicMemoryPort,
} from '../../../episodic-memory/domain/port/episodic-memory.port';
import {
  PR_REVIEW_OUTCOME_REPOSITORY_PORT,
  PrReviewOutcomeRepositoryPort,
} from '../domain/port/pr-review-outcome.repository.port';
import { SaveReviewOutcomeInput } from '../domain/pr-review-outcome.type';

@Injectable()
export class SaveReviewOutcomeUsecase {
  private readonly logger = new Logger(SaveReviewOutcomeUsecase.name);

  constructor(
    @Inject(PR_REVIEW_OUTCOME_REPOSITORY_PORT)
    private readonly repository: PrReviewOutcomeRepositoryPort,
    // episodic 은 옵셔널 — 미주입 시 기존 저장만(회귀 0).
    @Optional()
    @Inject(EPISODIC_MEMORY_PORT)
    private readonly episodicMemory?: EpisodicMemoryPort,
  ) {}

  async execute(input: SaveReviewOutcomeInput): Promise<void> {
    await this.repository.save(input);
    this.recordRejectEpisode(input);
  }

  // reject(accepted=false) + comment 존재 시에만 episodic 적재 — 다음 리뷰의 negative example.
  // fire-and-forget(본 흐름 비차단). accept/positive 는 1차 범위 밖.
  private recordRejectEpisode(input: SaveReviewOutcomeInput): void {
    if (
      !this.episodicMemory ||
      input.accepted ||
      input.comment === undefined ||
      input.comment.trim().length === 0
    ) {
      return;
    }
    void this.episodicMemory
      .record({
        kind: 'pr_review',
        agentType: 'CODE_REVIEWER',
        agentRunId: input.agentRunId,
        content: input.comment,
        occurredAt: new Date(),
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `reject episodic 적재 실패 (swallow): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
