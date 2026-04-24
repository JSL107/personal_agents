import { Inject, Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { GithubException } from '../domain/github.exception';
import {
  AssignedTasks,
  GithubIssue,
  GithubPullRequest,
  PullRequestDetail,
  PullRequestDiff,
} from '../domain/github.type';
import { GithubErrorCode } from '../domain/github-error-code.enum';
import {
  GetPullRequestDiffOptions,
  GithubClientPort,
  ListAssignedTasksOptions,
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
  constructor(
    @Inject(OCTOKIT_INSTANCE) private readonly octokit: Octokit | null,
  ) {}

  async listMyAssignedTasks({
    limit = DEFAULT_LIMIT,
  }: ListAssignedTasksOptions = {}): Promise<AssignedTasks> {
    this.assertOctokitConfigured();

    const perPage = Math.min(limit, MAX_LIMIT);

    const response = await this.invokeSearch(perPage);

    const issues: GithubIssue[] = [];
    const pullRequests: GithubPullRequest[] = [];
    for (const item of response.data.items) {
      if (item.pull_request) {
        pullRequests.push(this.toPullRequest(item));
      } else {
        issues.push(this.toIssue(item));
      }
    }

    return { issues, pullRequests };
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

  private async invokeSearch(perPage: number) {
    try {
      // assignee:@me 는 인증된 사용자에게 할당된 모든 open issue/PR 을 한 번에 조회한다.
      // PR 도 GitHub API 상 issue 의 일종이라 search/issues 엔드포인트로 함께 받는다.
      return await this.octokit!.rest.search.issuesAndPullRequests({
        q: 'assignee:@me state:open',
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
    };
  }
}

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
