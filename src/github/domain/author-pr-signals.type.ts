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
  open: boolean;
  draft: boolean;
  mergeableState: MergeableState;
  isApproved: boolean;
  pendingReviewers: string[];
  changesRequestedBy: string[];
  observed: boolean;
  // 내가 직접 한 마지막 활동 시각(push·리뷰·코멘트·draft 전환·PR 생성). 남이 일으킨 갱신은 넣지 않는다 — 「움직임 없음」 신호다.
  lastAuthorActivityAt?: string;
}
export interface AuthorTurnResult {
  turn: AuthorTurn;
  reason: AuthorTurnReason | null;
}
