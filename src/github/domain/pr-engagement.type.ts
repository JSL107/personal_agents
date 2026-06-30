// assigned PR 의 "내 차례인가 / 대기인가" 판정을 위한 신호 묶음.
// octokit client 가 best-effort 로 채우고, classify-pr-engagement 가 소비한다.
export type MergeableState =
  | 'clean'
  | 'dirty'
  | 'blocked'
  | 'behind'
  | 'unstable'
  | 'draft'
  | 'unknown';

export interface PullRequestEngagementSignals {
  repo: string; // "owner/repo"
  number: number;
  title: string;
  url: string;
  isApproved: boolean;
  iAmAuthor: boolean;
  // GitHub 가 아직 내 리뷰를 기다리는 상태 (requested_reviewers 에 내가 포함 = 미리뷰).
  iAmRequestedReviewer: boolean;
  // 내 최신 결정적 리뷰가 CHANGES_REQUESTED.
  iRequestedChanges: boolean;
  // 최근 WAITING_LOOKBACK_HOURS 내 내가 리뷰/코멘트했고 그 이후 타인 활동이 없음.
  iActedRecently: boolean;
  mergeableState: MergeableState;
}

export type EngagementState = 'ACTIVE' | 'WAITING';

export interface EngagementClassification {
  state: EngagementState;
  reason: string; // WAITING 사유. ACTIVE 면 빈 문자열.
}

// 브리핑 "대기 중" 섹션에 렌더할 항목 (PR 에서 파생).
export interface WaitingItem {
  title: string;
  url: string;
  reason: string;
}
