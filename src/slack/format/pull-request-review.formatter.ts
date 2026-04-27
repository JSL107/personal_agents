import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';

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
    review.summary,
  ];

  if (review.mustFix.length > 0) {
    lines.push('', '*Must-Fix*', ...review.mustFix.map((item) => `• ${item}`));
  }

  if (review.niceToHave.length > 0) {
    lines.push(
      '',
      '*Nice-to-have*',
      ...review.niceToHave.map((item) => `• ${item}`),
    );
  }

  if (review.missingTests.length > 0) {
    lines.push(
      '',
      '*누락 테스트*',
      ...review.missingTests.map((item) => `• ${item}`),
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
      lines.push(`• ${location}${draft.body}`);
    }
  }

  return lines.join('\n');
};
