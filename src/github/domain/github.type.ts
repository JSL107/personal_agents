export interface GithubIssue {
  number: number;
  title: string;
  repo: string; // "owner/repo"
  url: string; // html_url
  labels: string[];
  updatedAt: string; // ISO 8601
  body?: string;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  repo: string;
  url: string;
  draft: boolean;
  updatedAt: string;
  requestedReviewers: string[];
  // 리뷰가 끝나 머지만 남은 PR 표식. reviewer 별 최신 review 가 APPROVED 인 경우 true.
  // Morning Briefing 에서는 제외하고, 수동 /today 에서는 LLM 후순위 판단용 라벨로 노출한다.
  isApproved: boolean;
}

export interface AssignedTasks {
  issues: GithubIssue[];
  pullRequests: GithubPullRequest[];
}

// 단일 PR 상세 — Code Reviewer (`/review-pr`) 가 사용한다.
export interface PullRequestDetail {
  number: number;
  title: string;
  body: string;
  repo: string;
  url: string;
  baseRef: string; // 예: main
  headRef: string; // 예: feature/xyz
  authorLogin: string;
  changedFiles: string[];
  changedFilesTruncated: boolean; // hard cap (CHANGED_FILES_MAX) 초과로 잘렸는지
  changedFilesTotalCount: number; // PR 전체 변경 파일 수 (잘리기 전)
  additions: number;
  deletions: number;
  // 리뷰 시점 head commit sha — 카드의 커밋 대조 기준선(Phase 2)이자 인라인 코멘트의 commit_id.
  headSha: string;
}

export interface PullRequestDiff {
  diff: string; // unified diff
  truncated: boolean; // maxBytes 초과로 잘렸는지
  bytes: number;
}

// `/impact-report --recent <N>d` 다중 PR 종합용 lightweight summary.
// 단일 PR 상세 (PullRequestDetail) 와 분리 — body 는 cap 적용, changedFiles 목록은 count 만.
// 정량 종합 (additions/deletions/files 합산) + 정성 (title/body summary) 모두 가능한 최소 필드.
// state: 'merged' | 'open' — open PR 도 포함하도록 확장 (2026-06-09).
// mergedAt: open PR 이면 null, 머지 PR 이면 ISO 8601 string.
// updatedAt: merged/open 공통 정렬 키 (ISO 8601).
export interface GithubPullRequestSummary {
  number: number;
  title: string;
  body: string; // cap 적용 (caller 결정)
  repo: string; // "owner/repo"
  url: string;
  state: 'merged' | 'open';
  mergedAt: string | null; // open 이면 null, 머지 완료면 ISO 8601
  updatedAt: string; // ISO 8601 — merged/open 공통 정렬 키
  additions: number;
  deletions: number;
  changedFilesCount: number;
}

// PR 리뷰 루프 — 인라인 리뷰 코멘트 1건 게시.
// line 이 있으면 줄 단위, 없으면 파일 단위(subject_type: 'file')로 붙인다.
export interface CreateReviewCommentInput {
  repo: string; // "owner/repo"
  pullNumber: number;
  commitSha: string;
  filePath: string;
  line: number | null;
  body: string;
}

export interface CreateReviewCommentResult {
  commentId: string; // BigInt 를 문자열로
  nodeId: string; // GraphQL resolve(Phase 2) 대상
}
