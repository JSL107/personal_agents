import {
  EngagementClassification,
  PullRequestEngagementSignals,
} from './pr-engagement.type';

// 보수적 규칙 — 명확히 "내 차례 아님 / 내 몫 끝" 인 경우만 WAITING, 애매하면 ACTIVE.
// 위에서부터 첫 매치를 반환한다.
export const classifyPullRequestEngagement = (
  signals: PullRequestEngagementSignals,
): EngagementClassification => {
  if (signals.mergeableState === 'clean' && signals.isApproved) {
    return { state: 'WAITING', reason: '승인·충돌 없음 — 머지만 남음' };
  }
  if (signals.iRequestedChanges) {
    return { state: 'WAITING', reason: '변경 요청함 — 작성자 응답 대기' };
  }
  if (signals.iActedRecently && !signals.iAmRequestedReviewer) {
    return { state: 'WAITING', reason: '검토 남김 — 작성자/리뷰어 응답 대기' };
  }
  if (signals.mergeableState === 'blocked' && !signals.iAmRequestedReviewer) {
    return { state: 'WAITING', reason: '다른 리뷰어·CI 대기' };
  }
  if (signals.mergeableState === 'unstable' && !signals.iAmAuthor) {
    return { state: 'WAITING', reason: 'CI 실패 — 작성자 처리 대기' };
  }
  return { state: 'ACTIVE', reason: '' };
};
