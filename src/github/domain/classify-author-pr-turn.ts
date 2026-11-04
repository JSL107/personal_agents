import {
  AuthorPullRequestSignals,
  AuthorTurnResult,
} from './author-pr-signals.type';

export function classifyAuthorPullRequestTurn(
  signals: AuthorPullRequestSignals,
): AuthorTurnResult {
  if (!signals.observed) {
    return { turn: 'UNKNOWN', reason: null };
  }
  if (signals.draft) {
    return { turn: 'MY_TURN', reason: '드래프트' };
  }
  if (
    signals.latestChangesRequest &&
    !signals.pendingReviewers.includes(signals.latestChangesRequest.reviewer)
  ) {
    return { turn: 'MY_TURN', reason: '수정 요청 받음' };
  }
  if (signals.mergeableState === 'dirty') {
    return { turn: 'MY_TURN', reason: '충돌 있음' };
  }
  if (signals.isApproved && signals.mergeableState === 'clean') {
    return { turn: 'MY_TURN', reason: '승인됨' };
  }
  if (signals.isApproved && signals.mergeableState === 'behind') {
    return { turn: 'MY_TURN', reason: '브랜치 갱신 필요' };
  }
  if (signals.pendingReviewers.length > 0) {
    return { turn: 'WAITING_OTHERS', reason: '리뷰 대기' };
  }
  if (signals.mergeableState === 'unstable') {
    return { turn: 'MY_TURN', reason: 'CI 실패' };
  }
  return { turn: 'UNKNOWN', reason: null };
}
