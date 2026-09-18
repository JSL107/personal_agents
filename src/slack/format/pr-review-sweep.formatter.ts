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
// 두 수치는 설계 §7-3 에서 확정됐다(2026-09-18).
// - ±5%p: 표본 하한 20건에서 1건이 정확히 5%p 다(ADOPTION_MIN_SAMPLE). 더 낮추면 한 건마다 울린다.
// - 80%: 실측 전 카테고리가 93~100% 다. 80% 면 5건 중 1건이 기각된 상태라 볼 값이 있다.
//
// 상승도 올린다. 오르는 것은 조치가 필요 없지만, changePercentPoint 는 「규약을 실은 뒤 그
// 카테고리가 나아졌나」 를 재는 유일한 자리다(adoption-rate.ts 의 필드 주석). 학습이 실제로
// 효과를 냈다는 신호를 묻어 두면 그 판단을 다시 손으로 원장을 뒤져서 해야 한다.
const NOTABLE_CHANGE_PERCENT_POINT = 5;
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
    Math.abs(item.changePercentPoint) >= NOTABLE_CHANGE_PERCENT_POINT
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
  // 한 줄에 몰지 않고 줄로 나눈다. 쪼개기 유틸(breakProseIntoSentences)은 마침표를 기준으로
  // 삼으므로 `·` 로 이어 붙인 이 줄은 대상이 되지 않고, 길이 임계(100자)에도 못 미쳐 그대로
  // 나간다. 실제 발송에서 74자 한 줄이 화면 폭에 눌려 마지막 낱말만 다음 줄로 넘어갔다.
  //
  // 창 길이와 레포는 두 경우 모두 밝힌다 — 누적으로 오해하거나 여러 레포의 전체 성적으로
  // 읽는 사고가 있었다(이 파일 spec 의 해당 테스트 주석). 다만 매 회차 같은 값이므로
  // 수치 아래 별도 줄로 내려 첫 줄이 결론만 담게 한다.
  //
  // 「이상 없음」 대신 「정상」 을 쓴다. `그 외 3종 이상 없음` 이 `3종 이상(以上)` 으로 읽혀
  // 무슨 뜻인지 되물어 온 표현이다.
  //
  // notable 이 여럿이면 각각 자기 줄에 선다 — 한 줄에 이어 붙이면 고치려던 문제가 그대로 돌아온다.
  const measuredAdoption = harvest.adoption.filter(
    (item) => item.ratePercent !== null,
  );
  if (measuredAdoption.length > 0) {
    const notable = measuredAdoption.filter(isNotableAdoption);
    // 이탤릭으로 감싸지 않는다 — 코드스팬과 겹치면 Slack 이 밑줄 기호를 그대로 노출할 수 있고,
    // spec 은 문자열 포함만 보므로 그 렌더 실패를 잡지 못한다. 이 파일의 다른 줄도 코드스팬만 쓴다.
    const window = `최근 ${ADOPTION_WINDOW_DAYS}일 · \`${LEARNING_REPO}\``;
    if (notable.length === 0) {
      lines.push(`📊 채택률 ${measuredAdoption.length}종 모두 정상`, window);
    } else {
      const quietCount = measuredAdoption.length - notable.length;
      lines.push('📊 채택률');
      for (const {
        category,
        total,
        ratePercent,
        changePercentPoint,
      } of notable) {
        lines.push(
          `• ${escapeSlackMrkdwn(category)} ${ratePercent}%(${total})${formatChange(changePercentPoint)}`,
        );
      }
      if (quietCount > 0) {
        lines.push(`• 나머지 ${quietCount}종 정상`);
      }
      lines.push(window);
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
