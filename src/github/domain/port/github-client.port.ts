import {
  AssignedTasks,
  GithubPullRequest,
  GithubPullRequestSummary,
  PullRequestDetail,
  PullRequestDiff,
} from '../github.type';
import { PullRequestEngagementSignals } from '../pr-engagement.type';

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

// `/impact-report --recent <N>d` 다중 PR 종합 조회 옵션.
export interface ListAuthorMergedPullRequestsOptions {
  // "owner/repo" — env IMPACT_REPORT_GITHUB_REPO 에서 가져옴. null 이면 author 의 모든 repo
  // 머지 PR (본인이 작성한 PR 만, 다른 contributor repo 포함). owner/repo 는 search 결과
  // 의 repository_url 에서 per-PR 추출.
  repo: string | null;
  // GitHub login (username) — env IMPACT_REPORT_GITHUB_AUTHOR 에서 가져옴.
  author: string;
  // ISO date (YYYY-MM-DD) 또는 timezone offset 포함 ISO8601 timestamp. 이 시각 이후 merged 된 PR 만.
  sinceIsoDate: string;
  // 결과 상한. usecase 가 default 20 적용 — prompt 폭발 방지.
  limit: number;
}

// issues.opened webhook 자동 라벨링 — repo 의 기존 label vocab 조회 + LLM 이 고른 label 부분집합 적용.
export interface RepoLabel {
  name: string;
  description: string | null;
}

export interface AddIssueLabelsInput {
  repo: string; // "owner/repo"
  issueNumber: number;
  labels: string[]; // repo vocab 안의 name 배열. octokit 이 멱등 처리 (이미 붙은 label 은 noop).
}

// BE 자율 개발 Phase 2b-2 — 새 branch + single commit + PR open 1-shot.
// 호출자 (BeSandboxPushPrApplier) 가 변경된 file 의 post-patch content 까지 다 모은 뒤 본 메소드로 전달.
// Git Data API (createBlob → createTree → createCommit → createRef) + pulls.create chain.
// main 직접 push 금지 — 항상 새 branch (caller 가 branchName 명시).
export interface PushBranchAndOpenPrInput {
  repo: string; // "owner/repo"
  baseBranch: string;
  branchName: string; // 예: "feat/idaeri-1717xxxx" — caller 가 충돌 방지 책임
  commitMessage: string;
  files: { path: string; content: string }[]; // path = repo root 상대경로
  prTitle: string;
  prBody: string;
}

export interface PushBranchAndOpenPrResult {
  prUrl: string;
  prNumber: number;
  branchRef: string; // "refs/heads/<branchName>"
  commitSha: string;
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

  // `/impact-report --recent <N>d` — 지정 author 가 sinceIsoDate 이후 merge 한 PR 들의
  // lightweight summary (정량 stat + body cap 포함). limit 상한 이내 (mergedAt DESC).
  listAuthorMergedPullRequestsSince(
    options: ListAuthorMergedPullRequestsOptions,
  ): Promise<GithubPullRequestSummary[]>;

  // `/impact-report --recent <N>d` open PR 확장 — author 의 sinceIsoDate 이후 업데이트된
  // open PR 목록. `ListAuthorMergedPullRequestsOptions` 재사용 (같은 필드 구조).
  // 반환: state='open', mergedAt=null, updatedAt=updated_at (updatedAt DESC 정렬).
  listAuthorOpenPullRequests(
    options: ListAuthorMergedPullRequestsOptions,
  ): Promise<GithubPullRequestSummary[]>;

  // issues.opened webhook 자동 라벨링 — repo 의 label vocab (paginated).
  // 새 label 생성은 정책상 안 함 — LLM 이 vocab 안에서만 선택하도록 prompt 단에서 제한.
  listRepoLabels(repo: string): Promise<RepoLabel[]>;

  // 멱등 — 이미 붙어 있는 label 은 GitHub 가 noop 처리. labels 가 빈 배열이면 호출 자체 skip.
  addLabelsToIssue(input: AddIssueLabelsInput): Promise<void>;

  // BE 자율 개발 Phase 2b-2 — 새 branch + single commit + PR open 1-shot.
  // Git Data API 조합으로 1 commit (모든 변경 파일 합쳐서) → 새 branch ref → PR.
  // main 직접 push 절대 X.
  pushBranchAndOpenPr(
    input: PushBranchAndOpenPrInput,
  ): Promise<PushBranchAndOpenPrResult>;

  // 아침 브리핑 완료/대기 분류용 PR 신호 보강. best-effort — 실패/캡 초과 PR 은
  // 중립 신호(mergeableState='unknown', 모든 flag false)로 채워 분류 시 ACTIVE 로 떨어진다.
  fetchPullRequestEngagement(
    pullRequests: GithubPullRequest[],
  ): Promise<PullRequestEngagementSignals[]>;
}
