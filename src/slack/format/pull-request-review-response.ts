import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { formatAiHandoff } from '../../notification/domain/incident-message';
import { formatPullRequestReview } from './pull-request-review.formatter';

// 대화형 리뷰 경로에는 webhook처럼 스레드를 붙일 수 없다. 짧은 본문 아래에
// 원문을 마스킹한 AI 전달 블록을 붙여 상세 지적이 사라지지 않게 한다.
export const formatPullRequestReviewResponse = ({
  prRef,
  prTitle,
  review,
}: {
  prRef: string;
  prTitle?: string;
  review: PullRequestReview;
}): string => {
  const summary = formatPullRequestReview({ prRef, prTitle, review });
  const findings = [
    ...review.mustFix,
    ...review.niceToHave,
    ...review.missingTests,
    ...review.reviewCommentDrafts.map((draft) =>
      draft.file
        ? `${draft.file}${draft.line ? `:${draft.line}` : ''}: ${draft.body}`
        : draft.body,
    ),
    ...review.findings.map((finding) =>
      finding.file
        ? `${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.body}`
        : finding.body,
    ),
    ...(review.undeterminedReason ? [review.undeterminedReason] : []),
  ];
  if (findings.length === 0) {
    return summary;
  }

  const files = [...review.reviewCommentDrafts, ...review.findings].flatMap(
    (finding) =>
      finding.file
        ? [`${finding.file}${finding.line ? `:${finding.line}` : ''}`]
        : [],
  );
  const match = /^([^#]+)#(\d+)$/.exec(prRef);
  const link = match
    ? `https://github.com/${match[1]}/pull/${match[2]}`
    : prRef;
  const handoff = formatAiHandoff({
    feature: `${link} ${prTitle ?? review.summary}`,
    errorMessage: [...new Set(findings)].join('\n'),
    files: [...new Set(files)],
    checkCommand: null,
  });
  return `${summary}\n\n${handoff}`;
};
