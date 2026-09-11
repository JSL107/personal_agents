import { Injectable, Logger } from '@nestjs/common';

import { HarvestReviewSignalsUsecase } from '../../../pr-review-loop/application/harvest-review-signals.usecase';
import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
import { HarvestOutcome } from '../../../pr-review-loop/domain/harvest-outcome.type';
import {
  PublishOutcome,
  SweepPullRequestResult,
} from '../../../pr-review-loop/domain/publish-outcome.type';
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
      harvest,
      results: sweep.results,
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
// - posted: 이번 회차에 새로 게시한 카드 수. 이것이 없으면 그날 첫 발송(보통 카드 게시가
//   가져간다) 이후 오후에 지적이 새로 달려도 키가 그대로라 요약이 다음 날까지 묻힌다.
// - harvested: 이번 회차에 수확한 사용자 반응 수(채택·기각·수정·유실·해소). 같은 이유로
//   싣는다 — 반응은 카드 게시보다 뒤에 오므로, 없으면 반응 회차가 구조적으로 항상 막힌다
//   (harvest-review-signals.usecase 의 attachAdoption 주석이 같은 현상을 기록하고 있다).
// - contradicted: 건수를 싣는다. 그대로면 하루 1회를 지키고, 늘거나 줄면 다시 나간다.
// - quota-stopped: 켜짐/꺼짐만 싣는다. 30 시간짜리 중단 내내 같은 키라 하루 1회를
//   지키면서도, "낮에 정상 요약이 나간 뒤 저녁에 쿼터 소진" 처럼 그날 가드가 이미
//   소비된 뒤 끊긴 회차를 통과시킨다(그 경로가 없으면 중단이 다음 날까지 안 보인다).
//   복구되면 접미사가 사라져 키가 또 달라지므로 복구된 회차도 한 번 나간다.
//
// ⚠️ 남는 한계 — 값이 **건수**라, 같은 날 정확히 같은 조합이 두 번 나오면(예: 오전에 3건
//    게시, 오후에 또 3건 게시) 두 번째가 묻힌다. 완전히 없애려면 그날 누적 카운터를 따로
//    보관해야 하는데, 그 상태를 새로 만드는 비용보다 지금 구조(회차 값 지문)의 잔여 위험이
//    작다고 보고 남긴다. 기존(게시·반응이 키에 아예 없어 거의 항상 묻힘)보다는 크게 낫다.
//
// 구분자는 `+` 다. orchestrator 가 task 간 접미사를 `:` 로 잇기 때문에 겹치면 안 된다.
const buildGuardKeySuffix = ({
  harvest,
  results,
  quotaStopped,
}: {
  harvest: HarvestOutcome;
  results: SweepPullRequestResult[];
  quotaStopped: boolean;
}): string | null => {
  const parts: string[] = [];
  const posted = results.reduce(
    (total, result) => total + countPostedCards(result.outcome),
    0,
  );
  if (posted > 0) {
    parts.push(`posted-${posted}`);
  }
  const harvested =
    harvest.acked +
    harvest.rejected +
    harvest.fixed +
    harvest.stale +
    harvest.resolved;
  if (harvested > 0) {
    parts.push(`harvested-${harvested}`);
  }
  if (harvest.contradicted > 0) {
    parts.push(`contradicted-${harvest.contradicted}`);
  }
  if (quotaStopped) {
    parts.push('quota-stopped');
  }
  return parts.length > 0 ? parts.join('+') : null;
};

// 이번 회차에 "새로 화면에 뜬" 카드만 센다. duplicate(이미 있는 카드)·notPosted·dropped 는
// 요약에 새 내용을 더하지 않으므로 제외한다 — 넣으면 같은 상태가 회차마다 같은 수로 잡혀
// 키가 흔들리고, 내용 변화 없이 재발송되는 반대편 사고가 난다.
const countPostedCards = (outcome: PublishOutcome): number =>
  outcome.inline + outcome.file + outcome.issueComment + outcome.dryRun;

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
