import { PullRequestRef } from './port/github-client.port';
import { MergeableState } from './pr-engagement.type';

// 한 회차에 신호를 조회하는 내 PR 상한. 넘는 PR 은 observed=false 로 둔다.
export const AUTHOR_PR_SIGNAL_MAX = 30;

export type AuthorTurn = 'MY_TURN' | 'WAITING_OTHERS' | 'UNKNOWN';
export type AuthorTurnReason =
  | '드래프트'
  | '수정 요청 받음'
  | '충돌 있음'
  | '승인됨'
  | '브랜치 갱신 필요'
  | '리뷰 대기'
  | 'CI 실패';
export interface AuthorPullRequestSignals {
  ref: PullRequestRef;
  draft: boolean;
  mergeableState: MergeableState;
  isApproved: boolean;
  pendingReviewers: string[];
  latestChangesRequest: { reviewer: string; submittedAt: string } | null;
  observed: boolean;
}
export interface AuthorTurnResult {
  turn: AuthorTurn;
  reason: AuthorTurnReason | null;
}
