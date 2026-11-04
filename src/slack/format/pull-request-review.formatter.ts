import { PullRequestPublication } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { hasNoReviewFindings } from '../../agent/code-reviewer/domain/review-emptiness';
import { redactPii } from '../../common/util/pii-redaction.util';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const shortIssue = (value: string): string => {
  const firstLine = value.split('\n')[0].trim();
  const firstSentence = firstLine.split(/(?<=[.!?。])\s/)[0];
  const redacted = redactPii(firstSentence);
  const fenceSafe = redacted.replace(/```/g, "'''");
  return fenceSafe.slice(0, 80);
};

// /review-pr 결과 — PullRequestReview 를 한국어 Slack 마크다운으로 렌더.
export const formatPullRequestReview = ({
  prRef,
  prTitle,
  review,
}: {
  prRef: string;
  prTitle?: string;
  review: PullRequestReview;
}): string => {
  const listedIssues = [
    ...review.mustFix,
    ...review.niceToHave,
    ...review.missingTests,
  ];
  const seenIssues = new Set(listedIssues);
  const mustFix = [...review.mustFix];
  const considerations = [...review.niceToHave, ...review.missingTests];
  for (const finding of review.findings) {
    if (seenIssues.has(finding.body)) {
      continue;
    }
    seenIssues.add(finding.body);
    if (finding.severity === 'MUST_FIX') {
      mustFix.push(finding.body);
    } else {
      considerations.push(finding.body);
    }
  }
  const draftCount = review.reviewCommentDrafts.filter(
    (draft) => !seenIssues.has(draft.body),
  ).length;
  const title =
    shortIssue(prTitle ?? review.summary) ||
    shortIssue(review.summary) ||
    prRef;
  const lines: string[] = [
    `*${escapeSlackMrkdwn(title)} 리뷰*`,
    `위험도: ${{ low: '낮음', medium: '보통', high: '높음', unknown: '확인 불가' }[review.riskLevel]}`,
    `권고: ${{ approve: '승인', request_changes: '수정 요청', comment: '검토 필요', undetermined: '검토 필요' }[review.approvalRecommendation]}`,
    ...(mustFix.length
      ? [
          `꼭 고칠 것 ${mustFix.length}개`,
          ...mustFix.map(
            (issue) => `• ${escapeSlackMrkdwn(shortIssue(issue))}`,
          ),
        ]
      : []),
    ...(considerations.length
      ? [
          `고려할 것 ${considerations.length}개`,
          ...considerations.map(
            (issue) => `• ${escapeSlackMrkdwn(shortIssue(issue))}`,
          ),
        ]
      : []),
    ...Array.from({ length: draftCount }, () => '• 추가 검토 의견이 있어요.'),
  ];

  if (review.undeterminedReason !== undefined) {
    lines.push(
      `판단 보류: ${escapeSlackMrkdwn(shortIssue(review.undeterminedReason))}`,
    );
  }

  // 지적이 하나도 없으면 섹션이 통째로 빠져 요약만 남는다 — "리뷰가 잘렸나"로 읽히므로
  // 지적 없음을 명시한다. 다섯 목록을 모두 보는 판정은 스윕의 PR 코멘트와 공유한다
  // (hasNoReviewFindings) — 한쪽만 목록을 빠뜨리면 무증상으로 갈린다.
  // 판단 보류는 "고칠 것을 찾지 못했다" 가 아니라 "보지 못했다" 다 — 지적 없음 문구를 붙이지 않는다.
  if (
    hasNoReviewFindings(review) &&
    review.approvalRecommendation !== 'undetermined'
  ) {
    lines.push('*지적 사항 없음*');
  }

  return lines.join('\n');
};

// 게시 결과 한 줄 — 모델이 아니라 게시 단계의 실제 결과로 만든다. 리뷰 본문의 요약은 모델이
// 쓰므로 게시 여부를 거기서 읽게 하면 안 된다(2026-08-27 "게시 미확인" 은 모델이 지어낸 문장).
export const formatPullRequestPublication = (
  publication: PullRequestPublication,
): string => {
  switch (publication.kind) {
    case 'NOT_ALLOWED':
      return '_GitHub 게시 대상에 등록되지 않았어요._';
    case 'FAILED':
      // 예외 원문은 로그에만 남긴다 — 외부 API 응답·내부 경로가 사용자 메시지로 새지 않게(#747 리뷰).
      return '_GitHub 게시에 실패했어요. 리뷰 결과는 위와 같아요. 원인은 서버 로그에 남겼어요._';
    case 'DRY_RUN':
      return `_연습 모드라 GitHub 에 게시하지 않았어요 (게시 대상 ${publication.outcome.dryRun}건)._`;
    case 'POSTED': {
      const { outcome } = publication;
      // 인라인에 실패한 지적은 묶음 코멘트 한 건으로 올라가지만 집계는 지적 단위다. 그래서 "코멘트 N건"
      // 이 아니라 "지적 N건" 으로 쓴다(#747 리뷰).
      const posted = outcome.inline + outcome.file + outcome.issueComment;
      const extras = [
        outcome.duplicate > 0
          ? `이미 게시된 지적 ${outcome.duplicate}건 제외`
          : undefined,
        outcome.dropped > 0
          ? `게시 상한 초과 ${outcome.dropped}건 미게시`
          : undefined,
        outcome.notPosted > 0 ? `게시 실패 ${outcome.notPosted}건` : undefined,
      ].filter((part): part is string => part !== undefined);
      const link = `<https://github.com/${publication.repo}/pull/${publication.pullNumber}|PR>`;
      if (posted === 0 && extras.length === 0) {
        return `_게시할 지적이 없어 GitHub 에 코멘트를 달지 않았어요._`;
      }
      const head =
        posted > 0
          ? `GitHub ${link} 에 지적 ${posted}건을 게시했어요`
          : `새로 게시한 지적은 없어요`;
      return `_${[head, ...extras].join(' · ')}._`;
    }
  }
};
