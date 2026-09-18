import {
  ADOPTION_WINDOW_DAYS,
  CategoryAdoption,
} from '../../pr-review-loop/domain/adoption-rate';
import { HarvestOutcome } from '../../pr-review-loop/domain/harvest-outcome.type';
import { LEARNING_REPO } from '../../pr-review-loop/domain/learning-repo';
import {
  PublishOutcome,
  SweepPullRequestResult,
} from '../../pr-review-loop/domain/publish-outcome.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// 직전 구간 대비 변화. 두 구간 중 하나라도 표본이 미달이면 null 이 와서 아무것도 붙지 않는다 —
// 기준선이 없는 화살표는 추세처럼 보이지만 사실은 잡음이다.
const formatChange = (changePercentPoint: number | null): string => {
  if (changePercentPoint === null) {
    return '';
  }
  if (changePercentPoint === 0) {
    return ' →';
  }
  return changePercentPoint > 0
    ? ` ↑${changePercentPoint}%p`
    : ` ↓${Math.abs(changePercentPoint)}%p`;
};

// 본문에 올릴 카테고리의 기준. 나머지는 "이상 없음" 한 마디로 묶는다.
//
// 전에는 카테고리 전량을 한 줄에 이어 붙였다. 실제 발송 예(2026-09-18)는 카테고리 7개 ·
// 숫자 15개가 한 줄에 들어갔고, 그중 볼 값은 하나였다. 매일 같은 숫자가 오면 줄 전체를
// 읽지 않게 되므로 달라진 것만 앞세운다.
//
// 두 수치는 잠정값이다(설계 §7-3 미결). 5%p 는 사용자가 실물로 지적한 회차의 하락폭이고,
// 80% 는 그 회차 최저 측정 카테고리(93%)보다 낮게 둬 평시에 걸리지 않게 잡았다.
const NOTABLE_DROP_PERCENT_POINT = 5;
const NOTABLE_RATE_PERCENT = 80;

// 표본 미달(ratePercent === null)은 본문에도 "이상 없음" 집계에도 넣지 않는다 — 표본 1~7 건으로
// 낸 비율은 판단 근거가 못 되고, 그 사실을 매번 알릴 값도 없다.
const isNotableAdoption = (item: CategoryAdoption): boolean => {
  if (item.ratePercent === null) {
    return false;
  }
  if (item.ratePercent < NOTABLE_RATE_PERCENT) {
    return true;
  }
  return (
    item.changePercentPoint !== null &&
    item.changePercentPoint <= -NOTABLE_DROP_PERCENT_POINT
  );
};

const RISK_ICON: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
};

export interface FormatPrReviewSweepInput {
  harvest: HarvestOutcome;
  results: SweepPullRequestResult[];
  // 수확·리뷰 중 한쪽이라도 쿼터로 끊겼나. 카운터가 전부 0 이어도 이 회차는 보고 대상이다.
  quotaStopped?: boolean;
}

const COUNT_LABELS: { key: keyof PublishOutcome; label: string }[] = [
  { key: 'inline', label: '인라인' },
  { key: 'file', label: '파일' },
  { key: 'issueComment', label: '묶음' },
  { key: 'dryRun', label: '연습' },
  { key: 'notPosted', label: '미게시' },
  { key: 'dropped', label: '상한 초과' },
  { key: 'duplicate', label: '중복' },
];

// 키를 숫자 카운터로 한정한다 — HarvestOutcome 에는 누적 채택률(배열)도 들어 있어
// `keyof` 를 그대로 쓰면 `> 0` 비교가 타입에서 깨진다.
const HARVEST_COUNT_LABELS: {
  key: 'acked' | 'rejected' | 'fixed' | 'stale' | 'resolved' | 'contradicted';
  label: string;
}[] = [
  { key: 'acked', label: '👍' },
  { key: 'rejected', label: '👎' },
  { key: 'fixed', label: '🔧 해소' },
  { key: 'stale', label: '종료' },
  { key: 'resolved', label: '스레드 정리' },
  { key: 'contradicted', label: '보류' },
];

// 스윕 결과 요약. 게시할 게 없으면 빈 문자열 — 호출자가 skip 처리한다.
export const formatPrReviewSweep = ({
  harvest,
  results,
  quotaStopped = false,
}: FormatPrReviewSweepInput): string => {
  const harvestCounts = HARVEST_COUNT_LABELS.filter(
    ({ key }) => harvest[key] > 0,
  ).map(({ key, label }) => `${label} ${harvest[key]}`);
  if (results.length === 0 && harvestCounts.length === 0 && !quotaStopped) {
    return '';
  }
  const lines = ['*🤖 PR 리뷰 스윕*'];
  // 중단은 카운터가 아니라 한 줄 문장으로 낸다. `skipped` 를 라벨로 세우면 판정 대상이
  // 아니었던 카드까지 같은 숫자에 섞여 평상시 회차가 전부 잡음이 되고, 정작 "이번엔
  // 못 돌았다" 는 사실은 숫자 하나에 묻힌다. 같은 이유로 잔량도 붙이지 않는다 —
  // 수확은 멀쩡하고 리뷰만 끊긴 회차에서는 쿼터와 무관한 수가 "대기 중" 으로 보인다.
  // 정확한 잔량은 로그에 있다.
  if (quotaStopped) {
    lines.push('⏸️ 모델 쿼터 소진으로 이번 회차 중단 — 다음 회차에 재시도');
  }
  if (harvestCounts.length > 0) {
    lines.push(harvestCounts.join(' · '));
  }
  // 채택률은 카드 상태가 바뀐 회차에만 채워진다. 눈에 걸리는 카테고리만 수치로 내고,
  // 정상 범위는 개수로만 묶는다. 화살표는 직전 같은 길이 구간과의 차이다.
  //
  // 창 길이와 레포는 두 경우 모두 밝힌다 — 누적으로 오해하거나 여러 레포의 전체 성적으로
  // 읽는 사고가 있었다(이 파일 spec 의 해당 테스트 주석).
  const measuredAdoption = harvest.adoption.filter(
    (item) => item.ratePercent !== null,
  );
  if (measuredAdoption.length > 0) {
    const notable = measuredAdoption.filter(isNotableAdoption);
    if (notable.length === 0) {
      lines.push(
        `📊 채택률 이상 없음 (최근 ${ADOPTION_WINDOW_DAYS}일 · \`${LEARNING_REPO}\` ${measuredAdoption.length}종)`,
      );
    } else {
      const quietCount = measuredAdoption.length - notable.length;
      const notableText = notable
        .map(
          ({ category, total, ratePercent, changePercentPoint }) =>
            `${escapeSlackMrkdwn(category)} ${ratePercent}%(${total})${formatChange(changePercentPoint)}`,
        )
        .join(' · ');
      const quietText =
        quietCount > 0 ? ` · 그 외 ${quietCount}종 이상 없음` : '';
      lines.push(
        `📊 채택률(최근 ${ADOPTION_WINDOW_DAYS}일 · \`${LEARNING_REPO}\`) ${notableText}${quietText}`,
      );
    }
  }
  for (const result of results) {
    const icon = RISK_ICON[result.riskLevel] ?? '⚪';
    const counts = COUNT_LABELS.filter(
      ({ key }) => result.outcome[key] > 0,
    ).map(({ key, label }) => `${label} ${result.outcome[key]}`);
    // 모든 카운터가 0 인 결과는 현재 호출 경로에서 도달 불가(스윕이 findings 0건이면 게시 자체를 안 함).
    // 그래도 빈 목록이면 "— " 뒤가 비어 나가므로 대체 라벨로 막는다.
    lines.push(
      `${icon} \`${escapeSlackMrkdwn(result.prRef)}\` — ${counts.length > 0 ? counts.join(' · ') : '게시 없음'}`,
    );
  }
  return lines.join('\n');
};
