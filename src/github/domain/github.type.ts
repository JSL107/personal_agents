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
