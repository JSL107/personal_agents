import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { hasNoReviewFindings } from '../../agent/code-reviewer/domain/review-emptiness';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const RISK_LEVEL_LABEL: Record<PullRequestReview['riskLevel'], string> = {
  low: '🟢 LOW',
  medium: '🟡 MEDIUM',
  high: '🔴 HIGH',
};

const APPROVAL_LABEL: Record<
  PullRequestReview['approvalRecommendation'],
  string
> = {
  approve: '✅ Approve',
  request_changes: '✋ Request changes',
  comment: '💬 Comment',
};

// /review-pr 결과 — PullRequestReview 를 한국어 Slack 마크다운으로 렌더.
export const formatPullRequestReview = ({
  prRef,
  review,
}: {
  prRef: string;
  review: PullRequestReview;
}): string => {
  const lines: string[] = [
    `*PR 리뷰 — ${prRef}*`,
    `위험도: ${RISK_LEVEL_LABEL[review.riskLevel]} · 권고: ${APPROVAL_LABEL[review.approvalRecommendation]}`,
    '',
    '*요약*',
    escapeSlackMrkdwn(review.summary),
  ];

  if (review.mustFix.length > 0) {
    lines.push(
      '',
      '*Must-Fix*',
      ...review.mustFix.map((item) => `• ${escapeSlackMrkdwn(item)}`),
    );
  }

  if (review.niceToHave.length > 0) {
    lines.push(
      '',
      '*Nice-to-have*',
      ...review.niceToHave.map((item) => `• ${escapeSlackMrkdwn(item)}`),
    );
  }

  if (review.missingTests.length > 0) {
    lines.push(
      '',
      '*누락 테스트*',
      ...review.missingTests.map((item) => `• ${escapeSlackMrkdwn(item)}`),
    );
  }

  // 지적이 하나도 없으면 섹션이 통째로 빠져 요약만 남는다 — "리뷰가 잘렸나"로 읽히므로
  // 지적 없음을 명시한다. 다섯 목록을 모두 보는 판정은 스윕의 PR 코멘트와 공유한다
  // (hasNoReviewFindings) — 한쪽만 목록을 빠뜨리면 무증상으로 갈린다.
  if (hasNoReviewFindings(review)) {
    lines.push(
      '',
      '*지적 사항 없음* — 이번 diff 에서 고칠 것을 찾지 못했습니다.',
    );
  }

  if (review.reviewCommentDrafts.length > 0) {
    lines.push('', '*리뷰 코멘트 초안*');
    for (const draft of review.reviewCommentDrafts) {
      const location =
        draft.file && draft.line
          ? `\`${draft.file}:${draft.line}\` `
          : draft.file
            ? `\`${draft.file}\` `
            : '';
      // location(파일:라인)은 백틱 인라인 코드라 escape 제외, body(자유텍스트)만 escape.
      lines.push(`• ${location}${escapeSlackMrkdwn(draft.body)}`);
    }
  }

  return lines.join('\n');
};
