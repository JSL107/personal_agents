import { Injectable, Logger } from '@nestjs/common';

import { HarvestReviewSignalsUsecase } from '../../../pr-review-loop/application/harvest-review-signals.usecase';
import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
import { HarvestOutcome } from '../../../pr-review-loop/domain/harvest-outcome.type';
import { formatPrReviewSweep } from '../../../slack/format/pr-review-sweep.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// PR 리뷰 루프 Phase 1 — 열린 PR 을 찾아 리뷰하고 지적을 카드로 게시한다.
// 15분마다 돌기 때문에 할 일이 없으면 반드시 skip 해 빈 알림을 만들지 않는다.
// enable 판정·allowlist·연습 모드는 usecase 안에 있다(env 단일 소유).
@Injectable()
export class PrReviewSweepAutopilotTask implements AutopilotTask {
  readonly id = 'pr-review-sweep';
  private readonly logger = new Logger(PrReviewSweepAutopilotTask.name);

  constructor(
    private readonly harvestUsecase: HarvestReviewSignalsUsecase,
    private readonly sweepUsecase: SweepPrReviewsUsecase,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    let harvest = emptyHarvestOutcome();
    try {
      harvest = await this.harvestUsecase.execute();
    } catch (error: unknown) {
      this.logger.warn(
        `PR 리뷰 반응 수확 실패 — 신규 리뷰 스윕 계속: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const results = await this.sweepUsecase.execute();
    const hasHarvestResult =
      harvest.acked > 0 ||
      harvest.rejected > 0 ||
      harvest.fixed > 0 ||
      harvest.stale > 0 ||
      harvest.resolved > 0;
    if (!hasHarvestResult && results.length === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: formatPrReviewSweep({ harvest, results }),
    };
  }
}

const emptyHarvestOutcome = (): HarvestOutcome => ({
  acked: 0,
  rejected: 0,
  fixed: 0,
  stale: 0,
  resolved: 0,
  judged: 0,
  skipped: 0,
});
