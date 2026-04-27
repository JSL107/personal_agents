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

export interface GithubClientPort {
  listMyAssignedTasks(
    options?: ListAssignedTasksOptions,
  ): Promise<AssignedTasks>;

  getPullRequest(ref: PullRequestRef): Promise<PullRequestDetail>;

  getPullRequestDiff(
    options: GetPullRequestDiffOptions,
  ): Promise<PullRequestDiff>;
}
