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
  status: Extract<FindingStatus, 'ACKED' | 'REJECTED' | 'STALE'>;
  rejectReason: string | null;
  githubThreadNodeId: string | null;
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
