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
    const cardSignature = buildCardSignature(sweep.results);
    // skip 판정과 접미사 판정은 **같은 조건**을 봐야 한다. 예전처럼 `results.length === 0`
    // 으로 skip 을 가르면, 중복 카드(duplicate)만 나온 회차가 skip 을 빠져나온 뒤 접미사가
    // 비어 기본 날짜 키(`autopilot:pr-review-sweep:<날짜>`)로 발송된다. 그날 첫 발송이
    // 접미사 키를 소비했다면 기본 키는 아직 미소비라 그대로 통과해, 새 내용이 없는데도 요약이
    // 한 번 더 나간다(실측 2026-09-11 09:06:15 — 신규 지적 0 건인데 기본 키가 그때 생성됐다).
    //
    // 그래서 "보낼 내용이 있다" 의 정의를 하나로 모은다 — 카드 지문·수확·쿼터 중 하나라도
    // 있어야 발송이다. 다만 그 셋이 **전부** 접미사를 만들지는 않는다: 수확만 있는 회차는
    // 접미사 없이 기본 날짜 키를 써서 하루 1회로 접힌다(buildGuardKeySuffix 주석 참조).
    // 기본 키를 소비할 수 있는 회차가 「수확 전용」 하나로 좁혀지므로, 위가 경계한 중복 발송
    // (내용 없는 회차가 기본 키를 가져가는 것)은 그대로 막힌다 — duplicate 만 있는 회차는
    // 여기서 여전히 skip 이다.
    if (!hasHarvestResult && cardSignature === null && !quotaStopped) {
      return { skip: true };
    }
    const guardKeySuffix = buildGuardKeySuffix({
      harvest,
      cardSignature,
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
// - cards: 이번 회차에 새로 판정된 카드를 **PR 별로** 적은 지문. 이것이 없으면 그날 첫
//   발송(보통 카드 게시가 가져간다) 이후 오후에 지적이 새로 달려도 키가 그대로라 요약이
//   다음 날까지 묻힌다. 총 건수가 아니라 PR 별로 적는 이유는 아래 따로 쓴다.
// - harvested(채택·기각·수정·유실·해소): **싣지 않는다.** 한때 실었다 — 반응은 카드 게시보다
//   뒤에 오니 키에 없으면 반응 회차가 구조적으로 늘 막힌다는 이유였다. 그 결과 수확 건수가
//   달라질 때마다 요약이 나가, 2026-09-18 하루 23 회 발송 중 8 회가 수확 전용 회차였다
//   (Redis 가드 키 실측). 그 8 회가 알리는 것은 「내가 이미 단 👍/👎」·「머지돼 자동으로 닫힌
//   카드」 로, 전부 사후 집계다 — 받은 시점에 할 일이 없고, 채택률도 14 일 누적이라 3 분마다
//   달라지지 않는다. 알림으로 즉시 알아야 하는 것은 카드 게시(내가 PR 을 열어봐야 함)와 쿼터
//   중단(복구 확인)뿐이므로, 수확은 접미사를 비워 기본 날짜 키 = 하루 첫 1 회로 접는다.
//   묻히는 것은 **발송이지 처리가 아니다** — 수확 usecase 는 발송 가드와 무관하게 매 회차
//   그대로 돌아(run 첫 줄) 카드 상태와 채택률에 반영된다. Slack 에 줄이 안 뜰 뿐이고,
//   그날 두 번째 이후 수확 회차의 건수는 요약에서 보이지 않게 된다.
// - contradicted: 건수를 싣는다. 그대로면 하루 1회를 지키고, 늘거나 줄면 다시 나간다.
//   수확과 달리 보류는 **사람이 손대야 풀리는 미결 상태**라 즉시 알릴 값이 있다.
// - quota-stopped: 켜짐/꺼짐만 싣는다. 30 시간짜리 중단 내내 같은 키라 하루 1회를
//   지키면서도, "낮에 정상 요약이 나간 뒤 저녁에 쿼터 소진" 처럼 그날 가드가 이미
//   소비된 뒤 끊긴 회차를 통과시킨다(그 경로가 없으면 중단이 다음 날까지 안 보인다).
//   복구되면 접미사가 사라져 키가 또 달라지므로 복구된 회차도 한 번 나간다 — **단 그 회차에
//   카드나 보류가 있을 때만이다.** harvested 를 뺀 뒤로 복구 회차에 수확만 있으면 접미사가
//   비어 기본 날짜 키가 되고, 그날 기본 키가 이미 소비됐으면 발송되지 않는다. 복구를 알리는
//   것이 목적이라면 카드 게시가 그 역할을 한다(리뷰가 다시 돌았다는 뜻이고 접미사도 생긴다).
//   복구 전이 자체를 키에 실으려면 직전 회차가 쿼터였는지를 알아야 하는데, 이 task 는
//   stateless 라 그 상태를 Redis/DB 로 들여와야 한다 — 알림 한 줄 값에 비해 과해서 안 한다.
//
// ⚠️ contradicted 는 **건수**라, 같은 날 같은 수가 두 번 나오면 두 번째가 묻힌다. 수확 결과에는
//    대상 PR 정보가 실려 오지 않아(HarvestOutcome 은 카운터뿐) 카드처럼 지문을 만들 수 없다.
//    없애려면 수확 경로가 대상까지 올려보내야 하는데 이번 범위 밖이다.
//
// 이 함수는 호출부의 skip 판정과 짝이다 — 카드·수확·쿼터 중 하나라도 있으면 발송이고, 그중
// 접미사를 만드는 것은 카드·보류·쿼터다. 따라서 기본 날짜 키를 소비하는 회차는 **수확만 있는
// 회차뿐**이고, 그것이 곧 「수확 요약은 하루 1회」 라는 규칙이다.
// 구분자는 `+` 다. orchestrator 가 task 간 접미사를 `:` 로 잇기 때문에 겹치면 안 된다.
const buildGuardKeySuffix = ({
  harvest,
  cardSignature,
  quotaStopped,
}: {
  harvest: HarvestOutcome;
  cardSignature: string | null;
  quotaStopped: boolean;
}): string | null => {
  const parts: string[] = [];
  if (cardSignature) {
    parts.push(cardSignature);
  }
  if (harvest.contradicted > 0) {
    parts.push(`contradicted-${harvest.contradicted}`);
  }
  if (quotaStopped) {
    parts.push('quota-stopped');
  }
  return parts.length > 0 ? parts.join('+') : null;
};

// 이번 회차에 새로 판정된 카드를 PR 별로 적는다 — `cards-owner/repo#180x3.owner/repo#181x2`.
//
// 총 건수만 적으면 서로 다른 대상이 같은 키로 접힌다: 오전에 PR A 에서 1 건, 오후에 PR B 에서
// 1 건을 게시하면 둘 다 `1` 이라 후자가 "이미 발송됨" 으로 막힌다 — 이 변경이 없애려던 바로 그
// 시나리오다. PR 번호를 함께 적으면 대상이 다른 순간 키가 갈린다.
//
// 정렬하는 이유: 스윕이 PR 을 도는 순서가 회차마다 달라질 수 있는데, 순서가 키에 새면 같은
// 상태가 다른 키로 잡혀 내용 변화 없이 재발송된다. 스윕당 PR 상한이 3 이라(NEW_REVIEW_LIMIT_
// PER_SWEEP) 키 길이는 실질적으로 제한된다.
//
// duplicate(이미 있는 카드)만 제외한다. 게시 성공·연습·게시 실패(notPosted)·상한 초과(dropped)
// 는 전부 요약에 새 줄을 만들고, 뒤 둘은 오히려 사람이 봐야 하는 실패 신호다 — 빼면 그 회차가
// skip 으로 사라져 조용한 실패가 된다.
const countNewCards = (outcome: PublishOutcome): number =>
  outcome.inline +
  outcome.file +
  outcome.issueComment +
  outcome.dryRun +
  outcome.notPosted +
  outcome.dropped;

const buildCardSignature = (
  results: SweepPullRequestResult[],
): string | null => {
  const parts = results
    .map((result) => ({
      prRef: result.prRef,
      count: countNewCards(result.outcome),
    }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.prRef}x${entry.count}`)
    .sort();
  return parts.length > 0 ? `cards-${parts.join('.')}` : null;
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
