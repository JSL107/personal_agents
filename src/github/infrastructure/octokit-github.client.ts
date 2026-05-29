import { Inject, Injectable, Logger } from '@nestjs/common';
import { Octokit } from '@octokit/rest';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { GithubException } from '../domain/github.exception';
import {
  AssignedTasks,
  GithubIssue,
  GithubPullRequest,
  GithubPullRequestSummary,
  PullRequestDetail,
  PullRequestDiff,
} from '../domain/github.type';
import { GithubErrorCode } from '../domain/github-error-code.enum';
import {
  GetPullRequestDiffOptions,
  GithubClientPort,
  ListAssignedTasksOptions,
  ListAuthorMergedPullRequestsOptions,
  OCTOKIT_INSTANCE,
  PullRequestRef,
} from '../domain/port/github-client.port';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const DEFAULT_DIFF_MAX_BYTES = 50_000;
// PR 한 건에서 changedFiles 로 노출할 최대 파일 수.
// 이 이상은 잘리고 PullRequestDetail.changedFilesTruncated=true 로 호출자에게 알린다.
const CHANGED_FILES_MAX = 500;
const CHANGED_FILES_PAGE_SIZE = 100;

@Injectable()
export class OctokitGithubClient implements GithubClientPort {
  private readonly logger = new Logger(OctokitGithubClient.name);

  constructor(
    @Inject(OCTOKIT_INSTANCE) private readonly octokit: Octokit | null,
  ) {}

  async listMyAssignedTasks({
    limit = DEFAULT_LIMIT,
    updatedSinceIsoDate,
  }: ListAssignedTasksOptions = {}): Promise<AssignedTasks> {
    this.assertOctokitConfigured();

    const perPage = Math.min(limit, MAX_LIMIT);

    const response = await this.invokeSearch(perPage, updatedSinceIsoDate);

    const issues: GithubIssue[] = [];
    const pullRequests: GithubPullRequest[] = [];
    for (const item of response.data.items) {
      if (item.pull_request) {
        pullRequests.push(this.toPullRequest(item));
      } else {
        issues.push(this.toIssue(item));
      }
    }

    // PR 별 review 상태 (APPROVED) 채움. assigned PR 수가 보통 ≤30 이라 N+1 부담은 작다.
    // 실패 시 isApproved=false 로 fallback — 리뷰 조회 실패가 plan 흐름을 막지 않도록 graceful.
    await Promise.all(
      pullRequests.map(async (pr) => {
        pr.isApproved = await this.fetchIsApprovedSafely(pr);
      }),
    );

    return { issues, pullRequests };
  }

  private async fetchIsApprovedSafely(pr: GithubPullRequest): Promise<boolean> {
    try {
      const [owner, repoName] = parseRepo(pr.repo);
      const reviews = await this.octokit!.paginate(
        this.octokit!.rest.pulls.listReviews,
        { owner, repo: repoName, pull_number: pr.number, per_page: 100 },
      );
      return computeIsApprovedFromReviews(reviews);
    } catch (error: unknown) {
      // graceful — 권한 부족(scope 미충족)/rate limit/네트워크 실패 모두 isApproved=false 로 떨어진다.
      // 단, 가시성 확보를 위해 PR 정보와 함께 logger.warn 으로 기록 — silent drop 회피
      // (codex P1: 어떤 PR 의 승인 판정이 unknown 으로 떨어졌는지 추적 가능해야 함).
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `PR ${pr.repo}#${pr.number} listReviews 실패 — isApproved=false 로 fallback: ${message}`,
      );
      return false;
    }
  }

  async getPullRequest({
    repo,
    number,
  }: PullRequestRef): Promise<PullRequestDetail> {
    this.assertOctokitConfigured();
    const [owner, repoName] = parseRepo(repo);

    try {
      const prResponse = await this.octokit!.rest.pulls.get({
        owner,
        repo: repoName,
        pull_number: number,
      });

      const totalCount = prResponse.data.changed_files;
      const changedFiles = await this.fetchChangedFiles({
        owner,
        repoName,
        pullNumber: number,
      });

      return {
        number,
        title: prResponse.data.title,
        body: prResponse.data.body ?? '',
        repo,
        url: prResponse.data.html_url,
        baseRef: prResponse.data.base.ref,
        headRef: prResponse.data.head.ref,
        authorLogin: prResponse.data.user?.login ?? 'unknown',
        changedFiles,
        changedFilesTotalCount: totalCount,
        changedFilesTruncated:
          totalCount > changedFiles.length || totalCount > CHANGED_FILES_MAX,
        additions: prResponse.data.additions,
        deletions: prResponse.data.deletions,
      };
    } catch (error: unknown) {
      throw this.wrapRequestFailed(error, `PR #${number} 조회 실패`);
    }
  }

  // octokit.paginate 로 모든 페이지를 합치되 CHANGED_FILES_MAX 에서 끊는다.
  // 메모리 폭주 방지 + GitHub rate limit 보호 + Code Reviewer 프롬프트 길이 통제.
  private async fetchChangedFiles({
    owner,
    repoName,
    pullNumber,
  }: {
    owner: string;
    repoName: string;
    pullNumber: number;
  }): Promise<string[]> {
    const filenames: string[] = [];
    const iterator = this.octokit!.paginate.iterator(
      this.octokit!.rest.pulls.listFiles,
      {
        owner,
        repo: repoName,
        pull_number: pullNumber,
        per_page: CHANGED_FILES_PAGE_SIZE,
      },
    );
    for await (const page of iterator) {
      for (const file of page.data) {
        filenames.push(file.filename);
        if (filenames.length >= CHANGED_FILES_MAX) {
          return filenames;
        }
      }
    }
    return filenames;
  }

  async getPullRequestDiff({
    repo,
    number,
    maxBytes = DEFAULT_DIFF_MAX_BYTES,
  }: GetPullRequestDiffOptions): Promise<PullRequestDiff> {
    this.assertOctokitConfigured();
    const [owner, repoName] = parseRepo(repo);

    try {
      // mediaType: { format: 'diff' } 로 응답을 unified diff 텍스트로 직접 받는다.
      // octokit 타입은 JSON 으로 추론하지만 런타임은 string 이므로 cast 필요.
      const response = await this.octokit!.rest.pulls.get({
        owner,
        repo: repoName,
        pull_number: number,
        mediaType: { format: 'diff' },
      });
      const diff = response.data as unknown as string;
      const bytes = Buffer.byteLength(diff, 'utf-8');

      if (bytes > maxBytes) {
        return {
          diff: diff.slice(0, maxBytes),
          truncated: true,
          bytes,
        };
      }
      return { diff, truncated: false, bytes };
    } catch (error: unknown) {
      throw this.wrapRequestFailed(error, `PR #${number} diff 조회 실패`);
    }
  }

  private assertOctokitConfigured(): void {
    if (!this.octokit) {
      throw new GithubException({
        code: GithubErrorCode.TOKEN_NOT_CONFIGURED,
        message:
          'GITHUB_TOKEN 이 .env 에 설정되지 않아 GitHub API 를 호출할 수 없습니다.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
  }

  private wrapRequestFailed(error: unknown, prefix: string): GithubException {
    return new GithubException({
      code: GithubErrorCode.REQUEST_FAILED,
      message: `${prefix}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      cause: error,
    });
  }

  // PM-2: Issue/PR 에 코멘트 append. PreviewAction 의 status 전이가 멱등성 보장 (같은 preview 두 번 apply 불가).
  async addIssueComment({
    repo,
    number,
    body,
  }: {
    repo: string;
    number: number;
    body: string;
  }): Promise<void> {
    this.assertOctokitConfigured();
    const [owner, repoName] = parseRepo(repo);
    try {
      await this.octokit!.rest.issues.createComment({
        owner,
        repo: repoName,
        issue_number: number,
        body,
      });
    } catch (error: unknown) {
      throw this.wrapRequestFailed(
        error,
        `GitHub ${repo}#${number} 코멘트 추가 실패`,
      );
    }
  }

  // `/impact-report --recent <N>d` — author 가 sinceIsoDate 이후 merge 한 PR summary.
  // 흐름: search.issuesAndPullRequests 로 PR number 목록 회복 → 각 PR 에 pulls.get 으로
  // additions/deletions/changed_files/body 보강. N+1 호출이지만 limit 상한 (보통 ≤20) 이라 OK.
  // body cap 은 caller (usecase) 책임 — 본 client 는 full body 반환.
  async listAuthorMergedPullRequestsSince({
    repo,
    author,
    sinceIsoDate,
    limit,
  }: ListAuthorMergedPullRequestsOptions): Promise<GithubPullRequestSummary[]> {
    this.assertOctokitConfigured();
    const perPage = Math.min(Math.max(1, limit), 100);
    // repo null/empty → author 의 모든 repo 머지 PR (본인 작성 PR 만). qualifier 없는 search 가
    // user repo + contributor repo (fork merge 등) 모두 포함. repo 지정 시 해당 repo 한정.
    const repoQualifier = repo ? `repo:${repo} ` : '';
    const q = `${repoQualifier}is:pr is:merged author:${author} merged:>=${sinceIsoDate}`;
    const scopeLabel = repo ?? `author=${author} (all repos)`;
    let searchResponse;
    try {
      searchResponse = await this.octokit!.rest.search.issuesAndPullRequests({
        q,
        per_page: perPage,
        sort: 'updated',
        order: 'desc',
      });
    } catch (error: unknown) {
      throw this.wrapRequestFailed(
        error,
        `GitHub ${scopeLabel} merged PR 검색 실패`,
      );
    }

    // search 결과는 PullRequestSummary 의 일부 필드만 반환 — additions/deletions 등은 pulls.get
    // 으로 별도 회복. Promise.all 로 병렬화 (limit 작아 rate-limit 위험 낮음).
    // repo null 모드: per-PR 의 repository_url 에서 owner/repo 추출 (다른 repo 의 PR 포함).
    const itemsToFetch = searchResponse.data.items.slice(0, perPage);

    const details = await Promise.all(
      itemsToFetch.map(async (item) => {
        const itemRepo = repo ?? extractRepo(item.repository_url);
        const [owner, repoName] = parseRepo(itemRepo);
        try {
          const detail = await this.octokit!.rest.pulls.get({
            owner,
            repo: repoName,
            pull_number: item.number,
          });
          if (!detail.data.merged_at) {
            return null;
          }
          return {
            number: item.number,
            title: detail.data.title,
            body: detail.data.body ?? '',
            repo: itemRepo,
            url: detail.data.html_url,
            mergedAt: detail.data.merged_at,
            additions: detail.data.additions,
            deletions: detail.data.deletions,
            changedFilesCount: detail.data.changed_files,
          } satisfies GithubPullRequestSummary;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `GitHub PR ${itemRepo}#${item.number} 상세 조회 실패 (skip): ${message}`,
          );
          return null;
        }
      }),
    );

    return details
      .filter((d): d is GithubPullRequestSummary => d !== null)
      .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  }

  private async invokeSearch(perPage: number, updatedSinceIsoDate?: string) {
    try {
      // assignee:@me 는 인증된 사용자에게 할당된 모든 open issue/PR 을 한 번에 조회한다.
      // PR 도 GitHub API 상 issue 의 일종이라 search/issues 엔드포인트로 함께 받는다.
      // OPS-6: updatedSinceIsoDate 가 있으면 `updated:>=YYYY-MM-DD` qualifier 추가 — long-tail 컷.
      const baseQuery = 'assignee:@me state:open';
      const q = updatedSinceIsoDate
        ? `${baseQuery} updated:>=${updatedSinceIsoDate}`
        : baseQuery;
      return await this.octokit!.rest.search.issuesAndPullRequests({
        q,
        per_page: perPage,
        sort: 'updated',
        order: 'desc',
      });
    } catch (error: unknown) {
      throw this.wrapRequestFailed(error, 'GitHub assigned tasks 조회 실패');
    }
  }

  private toIssue(item: SearchItem): GithubIssue {
    return {
      number: item.number,
      title: item.title,
      repo: extractRepo(item.repository_url),
      url: item.html_url,
      labels: extractLabels(item.labels),
      updatedAt: item.updated_at,
      body: item.body ?? undefined,
    };
  }

  private toPullRequest(item: SearchItem): GithubPullRequest {
    return {
      number: item.number,
      title: item.title,
      repo: extractRepo(item.repository_url),
      url: item.html_url,
      draft: item.draft ?? false,
      updatedAt: item.updated_at,
      requestedReviewers: [],
      isApproved: false, // listMyAssignedTasks 가 reviews 조회 후 덮어씀.
    };
  }
}

// pulls.listReviews 응답에서 PR 의 approval 여부 계산.
// reviewer 별 최신 결정적 review 만 본다 (decisive = APPROVED / CHANGES_REQUESTED / DISMISSED).
// COMMENTED 는 approval 상태에 영향 X → 제외.
// DISMISSED 는 직전 APPROVED 가 무효화된 상태 → reduction 에 기록은 하되 최종 판정에서 non-approved 처리
// (omc/codex P1: APPROVED→DISMISSED 시퀀스 오판 방지).
// reviewer 식별이 불가능한 review (user=null 이고 login 도 없음) 는 reduction 에서 제외
// (omc P1: user:null reviewer 둘이 login:unknown 으로 머지되어 한쪽이 다른쪽을 덮는 오판 방지).
export type PullsReview = {
  state?: string | null;
  submitted_at?: string | null;
  user?: { id?: number; login?: string } | null;
};

const DECISIVE_REVIEW_STATES = new Set([
  'APPROVED',
  'CHANGES_REQUESTED',
  'DISMISSED',
]);

export const computeIsApprovedFromReviews = (
  reviews: PullsReview[],
): boolean => {
  const latestByReviewer = new Map<string, PullsReview>();
  for (const review of reviews) {
    const state = review.state ?? '';
    if (!DECISIVE_REVIEW_STATES.has(state)) {
      continue;
    }
    const reviewerKey = buildReviewerKey(review);
    if (reviewerKey === null) {
      continue;
    }
    const previous = latestByReviewer.get(reviewerKey);
    if (
      !previous ||
      (review.submitted_at ?? '') > (previous.submitted_at ?? '')
    ) {
      latestByReviewer.set(reviewerKey, review);
    }
  }
  if (latestByReviewer.size === 0) {
    return false;
  }
  for (const review of latestByReviewer.values()) {
    if (review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
      return false;
    }
  }
  return Array.from(latestByReviewer.values()).some(
    (review) => review.state === 'APPROVED',
  );
};

const buildReviewerKey = (review: PullsReview): string | null => {
  if (review.user?.id !== undefined && review.user.id !== null) {
    return `id:${review.user.id}`;
  }
  const login = review.user?.login;
  if (login !== undefined && login.length > 0) {
    return `login:${login}`;
  }
  return null;
};

// search.issuesAndPullRequests 응답 item 의 구조 (필요한 필드만 추출).
type SearchItem = {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  updated_at: string;
  body?: string | null;
  draft?: boolean;
  pull_request?: unknown;
  labels?: Array<{ name?: string } | string>;
};

const extractRepo = (repositoryUrl: string): string => {
  // repository_url 예: https://api.github.com/repos/owner/repo
  const match = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
  return match ? match[1] : repositoryUrl;
};

// "owner/repo" 형태의 string 을 [owner, repo] 로 분리한다.
const parseRepo = (repo: string): [string, string] => {
  const slash = repo.indexOf('/');
  if (slash <= 0 || slash === repo.length - 1) {
    throw new GithubException({
      code: GithubErrorCode.REQUEST_FAILED,
      message: `잘못된 repo 형식: "${repo}" (expected "owner/repo")`,
      status: DomainStatus.BAD_REQUEST,
    });
  }
  return [repo.slice(0, slash), repo.slice(slash + 1)];
};

const extractLabels = (labels: SearchItem['labels']): string[] => {
  if (!Array.isArray(labels)) {
    return [];
  }
  const out: string[] = [];
  for (const label of labels) {
    if (typeof label === 'string') {
      out.push(label);
    } else if (label && typeof label.name === 'string') {
      out.push(label.name);
    }
  }
  return out;
};
