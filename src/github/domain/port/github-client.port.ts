import {
  AssignedTasks,
  PullRequestDetail,
  PullRequestDiff,
} from '../github.type';

export const GITHUB_CLIENT_PORT = Symbol('GITHUB_CLIENT_PORT');

// Octokit 인스턴스 자체를 주입하기 위한 DI 토큰. 어댑터 외부에서 직접 참조하지 않으며,
// `OctokitGithubClient` 의 생성자에서만 주입받아 테스트 시 mock Octokit 으로 교체 가능하게 한다.
export const OCTOKIT_INSTANCE = Symbol('OCTOKIT_INSTANCE');

export interface ListAssignedTasksOptions {
  limit?: number;
  // OPS-6: GitHub Search API 의 `updated:>=YYYY-MM-DD` qualifier 에 들어갈 ISO date.
  // 미지정 시 cutoff 적용 안 함 — usecase 가 ConfigService 기준으로 채워 넣는다.
  updatedSinceIsoDate?: string;
}

export interface PullRequestRef {
  repo: string; // "owner/repo"
  number: number;
}

export interface GetPullRequestDiffOptions extends PullRequestRef {
  maxBytes?: number;
}

// PM-2 Write-back: GitHub Issue 또는 PR 의 코멘트 영역에 외부 게시 가능한 텍스트를 append.
export interface AddIssueCommentInput {
  // "owner/repo" 형식.
  repo: string;
  // issue 또는 PR number — GitHub API 에서 PR 도 issue endpoint 의 일종으로 취급.
  number: number;
  body: string;
}

export interface GithubClientPort {
  listMyAssignedTasks(
    options?: ListAssignedTasksOptions,
  ): Promise<AssignedTasks>;

  getPullRequest(ref: PullRequestRef): Promise<PullRequestDetail>;

  getPullRequestDiff(
    options: GetPullRequestDiffOptions,
  ): Promise<PullRequestDiff>;

  // PM-2: 사용자 ✅ apply 후 Issue/PR 코멘트로 WBS subtask checklist 등을 append.
  // GitHub PAT 가 `repo` 또는 fine-grained `Issues: Read+Write` scope 가 있어야 동작.
  addIssueComment(input: AddIssueCommentInput): Promise<void>;
}
