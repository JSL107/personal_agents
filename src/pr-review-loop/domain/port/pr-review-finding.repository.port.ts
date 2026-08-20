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
   * GitHub 에 올리지 않기로 한 카드를 종결한다.
   *
   * 이 경로가 없던 동안 게시하지 않은 카드가 `OPEN` 인 채로 원장에 영구히 쌓였다. 수확
   * 스윕은 게시된 카드만 본다(`findOpenPostedCards` 의 `githubCommentId: { not: null }`) —
   * 맞는 조건이다. GitHub 에 스레드가 없으면 거둘 반응도 없다. 문제는 그 카드들이 PR 이
   * 머지된 뒤에도 `STALE` 로 내려갈 길이 없다는 것이었고, 실제로 2026-08-20 기준 미결
   * 21건 중 16건이 이미 닫힌 PR 의 미게시 카드였다.
   *
   * 채택률에는 영향이 없다 — `SUPPRESSED` 도 `OPEN` 도 분모(`ACKED`/`FIXED`/`REJECTED`)
   * 밖이다. 바뀌는 것은 "아직 안 본 지적" 목록의 정직함뿐이다.
   */
  markSuppressed(id: number): Promise<void>;

  // 카테고리·상태별 카드 수. 채택률 분모 판정은 summarizeAdoption 이 하므로 여기서는
  // 상태를 걸러내지 않고 조합을 그대로 넘긴다.
  countAdoptionByCategory(): Promise<CategoryStatusCount[]>;
}
