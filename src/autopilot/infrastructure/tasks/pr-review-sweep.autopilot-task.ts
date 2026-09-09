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
    const sweep = await this.sweepUsecase.execute();
    const hasHarvestResult =
      harvest.acked > 0 ||
      harvest.rejected > 0 ||
      harvest.fixed > 0 ||
      harvest.stale > 0 ||
      harvest.resolved > 0 ||
      // 보류는 사람이 손대야 풀린다 — 이 조건에 없으면 보류만 있는 회차가 통째로
      // skip 되어 카드가 조용히 OPEN 에 쌓인다.
      harvest.contradicted > 0;
    // 쿼터로 끊긴 회차는 "할 일이 없었다" 가 아니다. 이 조건이 없으면 산출물이 0 이라
    // skip 으로 빠져 Slack 에 아무것도 안 나간다 — 실측(2026-08-07~08)으로 26 회차
    // 연속 쿼터 실패 동안 요약이 한 번도 나가지 않아, 30 시간짜리 중단이 원장에만
    // 남고 사용자에게는 평소와 똑같이 조용했다.
    const quotaStopped = harvest.quotaStopped || sweep.quotaStopped;
    if (!hasHarvestResult && sweep.results.length === 0 && !quotaStopped) {
      return { skip: true };
    }
    const guardKeySuffix = buildGuardKeySuffix({
      contradicted: harvest.contradicted,
      quotaStopped,
    });
    return {
      skip: false,
      summaryText: formatPrReviewSweep({
        harvest,
        results: sweep.results,
        quotaStopped,
      }),
      ...(guardKeySuffix === null ? {} : { guardKeySuffix }),
    };
  }
}

// 하루 1회 발송 가드는 그룹×날짜 키다(autopilot.orchestrator buildGuardKey) — 그날 첫
// 회차가 이미 소비했으면 뒤에 새로 생긴 상태도 "이미 발송됨" 으로 묻힌다. 값이 달라진
// 회차만 새 키로 한 번 더 통과시키려고 접미사를 싣는다.
//
// - contradicted: 건수를 싣는다. 그대로면 하루 1회를 지키고, 늘거나 줄면 다시 나간다.
// - quota-stopped: 켜짐/꺼짐만 싣는다. 30 시간짜리 중단 내내 같은 키라 하루 1회를
//   지키면서도, "낮에 정상 요약이 나간 뒤 저녁에 쿼터 소진" 처럼 그날 가드가 이미
//   소비된 뒤 끊긴 회차를 통과시킨다(그 경로가 없으면 중단이 다음 날까지 안 보인다).
//   복구되면 접미사가 사라져 키가 또 달라지므로 복구된 회차도 한 번 나간다.
//
// 구분자는 `+` 다. orchestrator 가 task 간 접미사를 `:` 로 잇기 때문에 겹치면 안 된다.
const buildGuardKeySuffix = ({
  contradicted,
  quotaStopped,
}: {
  contradicted: number;
  quotaStopped: boolean;
}): string | null => {
  const parts: string[] = [];
  if (contradicted > 0) {
    parts.push(`contradicted-${contradicted}`);
  }
  if (quotaStopped) {
    parts.push('quota-stopped');
  }
  return parts.length > 0 ? parts.join('+') : null;
};

const emptyHarvestOutcome = (): HarvestOutcome => ({
  acked: 0,
  rejected: 0,
  fixed: 0,
  stale: 0,
  resolved: 0,
  judged: 0,
  skipped: 0,
  contradicted: 0,
  quotaStopped: false,
  adoption: [],
});
