import { HarvestOutcome } from '../../pr-review-loop/domain/harvest-outcome.type';
import {
  PublishOutcome,
  SweepPullRequestResult,
} from '../../pr-review-loop/domain/publish-outcome.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

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

const HARVEST_COUNT_LABELS: {
  key: keyof HarvestOutcome;
  label: string;
}[] = [
  { key: 'acked', label: '👍' },
  { key: 'rejected', label: '👎' },
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
