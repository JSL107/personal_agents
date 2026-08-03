import {
  CreateFindingInput,
  FindingStatus,
  MarkPostedInput,
  PrReviewFindingRecord,
} from '../pr-review-finding.type';

export const PR_REVIEW_FINDING_REPOSITORY_PORT = Symbol(
  'PR_REVIEW_FINDING_REPOSITORY_PORT',
);

export interface HasAnyForPullRequestInput {
  repo: string;
  pullNumber: number;
}

export interface MarkDecidedInput {
  id: number;
  status: Extract<FindingStatus, 'ACKED' | 'REJECTED' | 'FIXED' | 'STALE'>;
  rejectReason: string | null;
  githubThreadNodeId: string | null;
  // 스레드가 이미 닫혀 있어 결론과 닫힘을 함께 확정할 때 true.
  // 두 번의 쓰기로 나누면 첫 쓰기 뒤 실패했을 때 status 가 OPEN 이 아니게 되어
  // 다음 회차 조회(status='OPEN' AND resolvedAt IS NULL)에서 빠지고 재시도가 사라진다.
  resolveThread?: boolean;
}

export interface PrReviewFindingRepositoryPort {
  // 지문이 이미 있으면 null — 재스윕 시 같은 지적을 다시 만들지 않는다.
  createIfAbsent(
    input: CreateFindingInput,
  ): Promise<PrReviewFindingRecord | null>;

  // 이 PR 을 이미 리뷰했는지. PR 당 리뷰 1회 정책의 판정 근거.
  hasAnyForPullRequest(input: HasAnyForPullRequestInput): Promise<boolean>;

  markPosted(input: MarkPostedInput): Promise<void>;

  findOpenPostedCards(): Promise<PrReviewFindingRecord[]>;

  markDecided(input: MarkDecidedInput): Promise<void>;

  markThreadResolved(id: number): Promise<void>;
}
