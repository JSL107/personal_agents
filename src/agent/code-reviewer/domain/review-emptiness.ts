import { PullRequestReview } from './code-reviewer.type';

// 이 리뷰가 "지적 없음" 을 단언해도 되는가.
//
// 모델은 지적을 다섯 목록에 나눠 담고, 하나만 차 있어도 지적이 있는 리뷰다. 파서는 findings 를
// 3배열에서 파생시키지만(pr-review.parser.ts:47-50) reviewCommentDrafts 는 그 파생에 들어가지
// 않는다 — 초안만 찬 응답도 스키마 검사를 통과하므로(같은 파일 80-92), findings 만 보고
// "없음" 을 단언하면 리뷰 결과와 정반대가 된다.
//
// 판정을 한 곳에 둔다. Slack 카드와 스윕의 PR 코멘트가 각자 조건을 세면 한쪽이 목록을
// 빠뜨려도 무증상이고, 실제로 그렇게 갈렸다(PR #392 봇 리뷰).
export const hasNoReviewFindings = (review: PullRequestReview): boolean =>
  review.mustFix.length === 0 &&
  review.niceToHave.length === 0 &&
  review.missingTests.length === 0 &&
  review.reviewCommentDrafts.length === 0 &&
  review.findings.length === 0;
