import { CategoryStatusCount } from '../adoption-rate';
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

// 대표 브리핑 — 미회수 지적이 남은 PR 하나.
export interface OpenPostedPullRequestRow {
  repo: string;
  pullNumber: number;
  count: number;
  /** 그 PR 에서 가장 먼저 달린 미회수 지적의 시각. 방치 기간을 이 값으로 잰다. */
  oldestAt: Date;
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

  /**
   * 아직 반응이 없는 **게시된** 지적을 PR 단위로 집계한다. 상한 없이 전건이다.
   *
   * 수확 스윕이 쓰는 `findOpenPostedCards` 를 재사용하면 안 된다 — 그쪽은 한 회차의 처리량을
   * 묶으려고 최근 20개 PR 로 자르고 정렬도 최신순이라, 가장 오래 방치된 PR 이 21번째면
   * 통째로 빠진다. 브리핑은 바로 그 "가장 오래된 것" 을 골라 보여주고 남은 건수도 세므로,
   * 처리량 제한을 물려받으면 조용히 틀린 숫자를 낸다.
   */
  countOpenPostedByPullRequest(): Promise<OpenPostedPullRequestRow[]>;

  // 카테고리·상태별 카드 수. 채택률 분모 판정은 summarizeAdoption 이 하므로 여기서는
  // 상태를 걸러내지 않고 조합을 그대로 넘긴다.
  countAdoptionByCategory(): Promise<CategoryStatusCount[]>;
}
