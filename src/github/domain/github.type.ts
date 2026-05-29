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
}

export interface PullRequestDiff {
  diff: string; // unified diff
  truncated: boolean; // maxBytes 초과로 잘렸는지
  bytes: number;
}

// `/impact-report --recent <N>d` 다중 PR 종합용 lightweight summary.
// 단일 PR 상세 (PullRequestDetail) 와 분리 — body 는 cap 적용, changedFiles 목록은 count 만.
// 정량 종합 (additions/deletions/files 합산) + 정성 (title/body summary) 모두 가능한 최소 필드.
export interface GithubPullRequestSummary {
  number: number;
  title: string;
  body: string; // cap 적용 (caller 결정)
  repo: string; // "owner/repo"
  url: string;
  mergedAt: string; // ISO 8601
  additions: number;
  deletions: number;
  changedFilesCount: number;
}
