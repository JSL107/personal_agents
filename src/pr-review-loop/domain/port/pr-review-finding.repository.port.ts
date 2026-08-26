import { CategoryStatusCount } from '../adoption-rate';

export interface AdoptionWindowInput {
  // 이 시각 이후에 결론이 난 카드. 경계는 [since, until) 로 다룬다.
  since: Date;
  // 생략하면 상한 없음(= 지금까지). 직전 구간을 조회할 때만 준다.
  until?: Date;
}
import {
  CreateFindingInput,
  FindingStatus,
  MarkPostedInput,
  PrReviewFindingRecord,
  RejectedFindingSummary,
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

export interface FindRejectionsForConventionsInput {
  repo: string;
  /**
   * 이 시각 이후 **확정된**(`decidedAt`) 기각만. 조회 조건이 곧 규약의 만료 기한이다.
   *
   * `resolvedAt` 이 아니라 `decidedAt` 이다 — 기각을 저장한 뒤 GitHub 스레드 닫기가
   * 실패하면 `resolvedAt` 만 null 로 남는데, 그때 status 는 이미 `REJECTED` 라 다음
   * 수확에서도 복구되지 않는다. 그 카드를 `resolvedAt` 으로 조회하면 학습 신호가
   * 영구히 빠진다. 결정의 정본은 `decidedAt` 이다.
   */
  since: Date;
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
  //
  // 구간은 **결론 시각**(`decidedAt`)으로 자른다. 게시 시각으로 자르면 오래 열려 있던 PR 의
  // 카드가 결론이 난 회차가 아니라 게시된 회차에 세어져, "이번 2주에 무엇이 채택됐나" 가
  // 흐려진다.
  countAdoptionByCategory(
    input: AdoptionWindowInput,
  ): Promise<CategoryStatusCount[]>;

  /**
   * 이 레포에서 기각된 지적과 그 이유. 다음 리뷰의 규약 블록 재료다.
   *
   * 임계·상한·길이 컷은 `renderLearnedConventions` 가 맡는다 — 여기서는 학습 재료가 될 수
   * 없는 행만 뺀다(이유 없는 기각, 기간 밖). 90일 기각이 십수 건 수준이라 전건을 넘겨도
   * 무해하고, 선별을 순수 함수에 두면 규칙을 테스트로 고정할 수 있다.
   */
  findRejectionsForConventions(
    input: FindRejectionsForConventionsInput,
  ): Promise<RejectedFindingSummary[]>;
}
