import { Injectable } from '@nestjs/common';

import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
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

  constructor(private readonly sweepUsecase: SweepPrReviewsUsecase) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const results = await this.sweepUsecase.execute();
    if (results.length === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: formatPrReviewSweep({ results }),
    };
  }
}
