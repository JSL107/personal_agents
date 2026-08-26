import { ADOPTION_WINDOW_DAYS } from '../../pr-review-loop/domain/adoption-rate';
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

const RISK_ICON: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
};

export interface FormatPrReviewSweepInput {
  harvest: HarvestOutcome;
  results: SweepPullRequestResult[];
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
  key: 'acked' | 'rejected' | 'fixed' | 'stale' | 'resolved';
  label: string;
}[] = [
  { key: 'acked', label: '👍' },
  { key: 'rejected', label: '👎' },
  { key: 'fixed', label: '🔧 해소' },
  { key: 'stale', label: '종료' },
  { key: 'resolved', label: '스레드 정리' },
];

// 스윕 결과 요약. 게시할 게 없으면 빈 문자열 — 호출자가 skip 처리한다.
export const formatPrReviewSweep = ({
  harvest,
  results,
}: FormatPrReviewSweepInput): string => {
  const harvestCounts = HARVEST_COUNT_LABELS.filter(
    ({ key }) => harvest[key] > 0,
  ).map(({ key, label }) => `${label} ${harvest[key]}`);
  if (results.length === 0 && harvestCounts.length === 0) {
    return '';
  }
  const lines = ['*🤖 PR 리뷰 스윕*'];
  if (harvestCounts.length > 0) {
    lines.push(harvestCounts.join(' · '));
  }
  // 채택률은 카드 상태가 바뀐 회차에만 채워진다. 표본이 미달인 카테고리는 비율을
  // 감추고 표본 수만 보여준다 — 4건으로 낸 비율이 판단 근거로 쓰이는 것을 막는다.
  // 화살표는 직전 같은 길이 구간과의 차이다. 규약이 선 카테고리가 실제로 나아졌는지는
  // 이 한 칸으로만 보인다 — 없으면 다시 손으로 원장을 뒤져야 한다.
  if (harvest.adoption.length > 0) {
    lines.push(
      `📊 채택률(최근 ${ADOPTION_WINDOW_DAYS}일 · \`${LEARNING_REPO}\`) ${harvest.adoption
        .map(({ category, total, ratePercent, changePercentPoint }) =>
          ratePercent === null
            ? `${escapeSlackMrkdwn(category)} 표본 ${total}`
            : `${escapeSlackMrkdwn(category)} ${ratePercent}%(${total})${formatChange(changePercentPoint)}`,
        )
        .join(' · ')}`,
    );
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
