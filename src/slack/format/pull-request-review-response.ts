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
  const handoff = formatReviewAiHandoff({ prRef, prTitle, review });
  if (handoff === null) {
    return summary;
  }
  return `${summary}\n\n${handoff}`;
};

// webhook(스레드)과 대화형(본문 아래) 두 경로가 같은 블록을 쓴다. 지적 원문이 없으면 null.
export const formatReviewAiHandoff = ({
  prRef,
  prTitle,
  review,
}: {
  prRef: string;
  prTitle?: string;
  review: PullRequestReview;
}): string | null => {
  const findings = collectReviewFindingTexts(review);
  if (findings.length === 0) {
    return null;
  }
  const feature = `${toPullRequestLink(prRef)} ${prTitle ?? review.summary}`;
  return formatAiHandoff({
    feature,
    errorMessage: findings.join('\n'),
    files: [],
    checkCommand: null,
  });
};

// 위치가 있는 지적은 `파일:줄: 본문` 으로 붙여 둔 뒤 중복을 거른다 — 위치를 먼저 붙여야
// 다른 파일의 같은 문구가 하나로 합쳐지지 않는다.
const collectReviewFindingTexts = (review: PullRequestReview): string[] => {
  const located = [...review.reviewCommentDrafts, ...review.findings].map(
    withLocation,
  );
  const undetermined = review.undeterminedReason
    ? [review.undeterminedReason]
    : [];
  const texts = [
    ...review.mustFix,
    ...review.niceToHave,
    ...review.missingTests,
    ...located,
    ...undetermined,
  ];
  return [...new Set(texts)];
};

// 코멘트 초안과 지적이 공통으로 갖는 위치·본문.
interface LocatedText {
  file?: string;
  line?: number;
  body: string;
}

const withLocation = (finding: LocatedText): string => {
  if (!finding.file) {
    return finding.body;
  }
  const line = finding.line ? `:${finding.line}` : '';
  return `${finding.file}${line}: ${finding.body}`;
};

const toPullRequestLink = (prRef: string): string => {
  const match = /^([^#]+)#(\d+)$/.exec(prRef);
  if (!match) {
    return prRef;
  }
  return `https://github.com/${match[1]}/pull/${match[2]}`;
};
