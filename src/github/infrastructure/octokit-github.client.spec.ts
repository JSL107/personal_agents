import { Octokit } from '@octokit/rest';

import { GithubException } from '../domain/github.exception';
import { GithubErrorCode } from '../domain/github-error-code.enum';
import {
  computeIsApprovedFromReviews,
  OctokitGithubClient,
  PullsReview,
} from './octokit-github.client';

describe('OctokitGithubClient', () => {
  // listMyAssignedTasks 가 PR 별 listReviews 로 isApproved 를 채우므로,
  // 기본 mock 은 빈 reviews 배열을 돌려주는 paginate 도 함께 제공한다 (default isApproved=false).
  // listReviews 별 시나리오 검증이 필요한 테스트는 paginateOverride 로 reviewer 시퀀스를 주입한다.
  const buildOctokitMock = (
    items: Array<Record<string, unknown>>,
    paginateOverride?: jest.Mock,
  ): Octokit =>
    ({
      rest: {
        search: {
          issuesAndPullRequests: jest
            .fn()
            .mockResolvedValue({ data: { items } }),
        },
        pulls: { listReviews: jest.fn() },
      },
      paginate: paginateOverride ?? jest.fn().mockResolvedValue([]),
    }) as unknown as Octokit;

  it('Octokit 인스턴스가 null 이면 TOKEN_NOT_CONFIGURED 예외', async () => {
    const client = new OctokitGithubClient(null);

    await expect(client.listMyAssignedTasks()).rejects.toMatchObject({
      githubErrorCode: GithubErrorCode.TOKEN_NOT_CONFIGURED,
    });
  });

  it('search 응답을 issues / pullRequests 로 분리한다', async () => {
    const octokit = buildOctokitMock([
      {
        number: 12,
        title: 'Bug: 크롤러 timeout',
        html_url: 'https://github.com/foo/bar/issues/12',
        repository_url: 'https://api.github.com/repos/foo/bar',
        updated_at: '2026-04-23T05:00:00Z',
        labels: [{ name: 'bug' }, 'priority:high'],
      },
      {
        number: 34,
        title: 'PR: GitHub 커넥터 추가',
        html_url: 'https://github.com/foo/bar/pull/34',
        repository_url: 'https://api.github.com/repos/foo/bar',
        updated_at: '2026-04-23T06:00:00Z',
        pull_request: { url: '...' },
        draft: true,
      },
    ]);
    const client = new OctokitGithubClient(octokit);

    const result = await client.listMyAssignedTasks();

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      number: 12,
      repo: 'foo/bar',
      labels: ['bug', 'priority:high'],
    });

    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0]).toMatchObject({
      number: 34,
      draft: true,
      repo: 'foo/bar',
    });
  });

  it('search 호출이 throw 하면 REQUEST_FAILED 예외로 감싼다', async () => {
    const octokit = {
      rest: {
        search: {
          issuesAndPullRequests: jest
            .fn()
            .mockRejectedValue(new Error('rate limit')),
        },
      },
    } as unknown as Octokit;
    const client = new OctokitGithubClient(octokit);

    await expect(client.listMyAssignedTasks()).rejects.toBeInstanceOf(
      GithubException,
    );
  });

  it('limit 은 100 으로 cap 되어 per_page 에 전달된다', async () => {
    const search = jest.fn().mockResolvedValue({ data: { items: [] } });
    const octokit = {
      rest: { search: { issuesAndPullRequests: search } },
    } as unknown as Octokit;
    const client = new OctokitGithubClient(octokit);

    await client.listMyAssignedTasks({ limit: 999 });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ per_page: 100 }),
    );
  });

  describe('getPullRequest', () => {
    const buildPrOctokit = ({
      changedFilesTotalCount,
      pages,
    }: {
      changedFilesTotalCount: number;
      pages: Array<{ filename: string }[]>;
    }): { octokit: Octokit; get: jest.Mock; listFiles: jest.Mock } => {
      const get = jest.fn().mockResolvedValue({
        data: {
          title: 'feat: foo',
          body: 'body text',
          html_url: 'https://github.com/foo/bar/pull/34',
          base: { ref: 'main' },
          head: { ref: 'feature/foo' },
          user: { login: 'octocat' },
          additions: 120,
          deletions: 30,
          changed_files: changedFilesTotalCount,
        },
      });
      const listFiles = jest.fn();
      const iterator = jest.fn(() => ({
        async *[Symbol.asyncIterator]() {
          for (const data of pages) {
            yield { data };
          }
        },
      }));
      const octokit = {
        rest: { pulls: { get, listFiles } },
        paginate: { iterator },
      } as unknown as Octokit;
      return { octokit, get, listFiles };
    };

    it('PR 메타 + changedFiles 를 합쳐 PullRequestDetail 로 반환한다', async () => {
      const { octokit, get } = buildPrOctokit({
        changedFilesTotalCount: 2,
        pages: [[{ filename: 'src/a.ts' }, { filename: 'src/b.ts' }]],
      });
      const client = new OctokitGithubClient(octokit);

      const detail = await client.getPullRequest({
        repo: 'foo/bar',
        number: 34,
      });

      expect(detail).toMatchObject({
        number: 34,
        title: 'feat: foo',
        repo: 'foo/bar',
        baseRef: 'main',
        headRef: 'feature/foo',
        authorLogin: 'octocat',
        changedFiles: ['src/a.ts', 'src/b.ts'],
        changedFilesTotalCount: 2,
        changedFilesTruncated: false,
        additions: 120,
        deletions: 30,
      });
      expect(get).toHaveBeenCalledWith({
        owner: 'foo',
        repo: 'bar',
        pull_number: 34,
      });
    });

    it('변경 파일이 CHANGED_FILES_MAX(500) 초과하면 잘리고 truncated=true', async () => {
      const huge: { filename: string }[] = [];
      for (let i = 0; i < 600; i++) {
        huge.push({ filename: `f${i}.ts` });
      }
      const { octokit } = buildPrOctokit({
        changedFilesTotalCount: 600,
        pages: [
          huge.slice(0, 100),
          huge.slice(100, 200),
          huge.slice(200, 300),
          huge.slice(300, 400),
          huge.slice(400, 500),
          huge.slice(500, 600),
        ],
      });
      const client = new OctokitGithubClient(octokit);

      const detail = await client.getPullRequest({
        repo: 'foo/bar',
        number: 1,
      });

      expect(detail.changedFiles).toHaveLength(500);
      expect(detail.changedFilesTruncated).toBe(true);
      expect(detail.changedFilesTotalCount).toBe(600);
    });

    it('잘못된 repo 형식이면 REQUEST_FAILED 예외', async () => {
      const client = new OctokitGithubClient({} as Octokit);

      await expect(
        client.getPullRequest({ repo: 'invalid', number: 1 }),
      ).rejects.toBeInstanceOf(GithubException);
    });
  });

  describe('getPullRequestDiff', () => {
    it('mediaType=diff 로 호출하고 diff 텍스트를 그대로 반환', async () => {
      const get = jest.fn().mockResolvedValue({
        data: 'diff --git a/x b/x\n+hello\n',
      });
      const octokit = {
        rest: { pulls: { get } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      const result = await client.getPullRequestDiff({
        repo: 'foo/bar',
        number: 1,
      });

      expect(result.diff).toContain('diff --git a/x b/x');
      expect(result.truncated).toBe(false);
      expect(get).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: { format: 'diff' },
        }),
      );
    });

    it('maxBytes 초과 시 잘리고 truncated=true', async () => {
      const big = 'x'.repeat(200);
      const get = jest.fn().mockResolvedValue({ data: big });
      const octokit = {
        rest: { pulls: { get } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      const result = await client.getPullRequestDiff({
        repo: 'foo/bar',
        number: 1,
        maxBytes: 50,
      });

      expect(result.diff).toHaveLength(50);
      expect(result.truncated).toBe(true);
      expect(result.bytes).toBe(200);
    });

    it('Octokit 인스턴스가 null 이면 TOKEN_NOT_CONFIGURED 예외', async () => {
      const client = new OctokitGithubClient(null);

      await expect(
        client.getPullRequestDiff({ repo: 'foo/bar', number: 1 }),
      ).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.TOKEN_NOT_CONFIGURED,
      });
    });
  });

  describe('listMyAssignedTasks — PR isApproved 판정', () => {
    const prItem = {
      number: 7,
      title: 'test PR',
      html_url: 'https://github.com/foo/bar/pull/7',
      repository_url: 'https://api.github.com/repos/foo/bar',
      updated_at: '2026-05-15T00:00:00Z',
      pull_request: { url: '...' },
      draft: false,
    };

    it('reviewer 모두 APPROVED 면 isApproved=true', async () => {
      const reviews: PullsReview[] = [
        {
          state: 'APPROVED',
          submitted_at: '2026-05-15T01:00:00Z',
          user: { id: 1, login: 'alice' },
        },
      ];
      const paginate = jest.fn().mockResolvedValue(reviews);
      const client = new OctokitGithubClient(
        buildOctokitMock([prItem], paginate),
      );

      const { pullRequests } = await client.listMyAssignedTasks();
      expect(pullRequests[0].isApproved).toBe(true);
    });

    it('어떤 reviewer 가 CHANGES_REQUESTED 면 isApproved=false', async () => {
      const reviews: PullsReview[] = [
        {
          state: 'APPROVED',
          submitted_at: '2026-05-15T01:00:00Z',
          user: { id: 1, login: 'alice' },
        },
        {
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-05-15T02:00:00Z',
          user: { id: 2, login: 'bob' },
        },
      ];
      const paginate = jest.fn().mockResolvedValue(reviews);
      const client = new OctokitGithubClient(
        buildOctokitMock([prItem], paginate),
      );

      const { pullRequests } = await client.listMyAssignedTasks();
      expect(pullRequests[0].isApproved).toBe(false);
    });

    it('APPROVED → DISMISSED 시퀀스는 isApproved=false (codex/omc P1)', async () => {
      const reviews: PullsReview[] = [
        {
          state: 'APPROVED',
          submitted_at: '2026-05-15T01:00:00Z',
          user: { id: 1, login: 'alice' },
        },
        {
          state: 'DISMISSED',
          submitted_at: '2026-05-15T03:00:00Z',
          user: { id: 1, login: 'alice' },
        },
      ];
      const paginate = jest.fn().mockResolvedValue(reviews);
      const client = new OctokitGithubClient(
        buildOctokitMock([prItem], paginate),
      );

      const { pullRequests } = await client.listMyAssignedTasks();
      expect(pullRequests[0].isApproved).toBe(false);
    });

    it('listReviews 가 throw 하면 isApproved=false 로 fallback (graceful)', async () => {
      const paginate = jest.fn().mockRejectedValue(new Error('scope missing'));
      const client = new OctokitGithubClient(
        buildOctokitMock([prItem], paginate),
      );

      const { pullRequests } = await client.listMyAssignedTasks();
      expect(pullRequests[0].isApproved).toBe(false);
    });
  });

  describe('computeIsApprovedFromReviews — unit', () => {
    const review = (
      state: string,
      submittedAt: string,
      user: { id?: number; login?: string } | null,
    ): PullsReview => ({ state, submitted_at: submittedAt, user });

    it('빈 reviews → false', () => {
      expect(computeIsApprovedFromReviews([])).toBe(false);
    });

    it('COMMENTED 만 있으면 결정적 상태가 없으므로 false', () => {
      expect(
        computeIsApprovedFromReviews([
          review('COMMENTED', '2026-05-15T01:00:00Z', { id: 1 }),
        ]),
      ).toBe(false);
    });

    it('같은 reviewer 의 APPROVED → CHANGES_REQUESTED 시퀀스 → false', () => {
      expect(
        computeIsApprovedFromReviews([
          review('APPROVED', '2026-05-15T01:00:00Z', { id: 1 }),
          review('CHANGES_REQUESTED', '2026-05-15T02:00:00Z', { id: 1 }),
        ]),
      ).toBe(false);
    });

    it('같은 reviewer 의 CHANGES_REQUESTED → APPROVED 시퀀스 → true', () => {
      expect(
        computeIsApprovedFromReviews([
          review('CHANGES_REQUESTED', '2026-05-15T01:00:00Z', { id: 1 }),
          review('APPROVED', '2026-05-15T02:00:00Z', { id: 1 }),
        ]),
      ).toBe(true);
    });

    it('식별 불가 reviewer (user=null) 는 reduction 에서 제외 (omc P1)', () => {
      // user=null reviewer 의 CHANGES_REQUESTED 가 다른 reviewer 의 APPROVED 를 덮으면 안 됨
      expect(
        computeIsApprovedFromReviews([
          review('APPROVED', '2026-05-15T01:00:00Z', { id: 1, login: 'alice' }),
          review('CHANGES_REQUESTED', '2026-05-15T02:00:00Z', null),
        ]),
      ).toBe(true);
    });
  });

  describe('listRepoLabels — issues.opened 자동 라벨링 vocab 회복', () => {
    it('paginate 결과를 RepoLabel[] 로 정규화 (description 누락은 null)', async () => {
      const paginate = jest
        .fn()
        .mockResolvedValue([
          { name: 'bug', description: '버그 보고서' },
          { name: 'docs', description: null },
          { name: 'wontfix' },
        ]);
      const octokit = {
        rest: { issues: { listLabelsForRepo: jest.fn() } },
        paginate,
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      const labels = await client.listRepoLabels('foo/bar');

      expect(labels).toEqual([
        { name: 'bug', description: '버그 보고서' },
        { name: 'docs', description: null },
        { name: 'wontfix', description: null },
      ]);
      expect(paginate).toHaveBeenCalledWith(
        (
          octokit as unknown as {
            rest: { issues: { listLabelsForRepo: unknown } };
          }
        ).rest.issues.listLabelsForRepo,
        expect.objectContaining({ owner: 'foo', repo: 'bar', per_page: 100 }),
      );
    });

    it('paginate throw 시 REQUEST_FAILED 로 감싼다', async () => {
      const octokit = {
        rest: { issues: { listLabelsForRepo: jest.fn() } },
        paginate: jest.fn().mockRejectedValue(new Error('rate limited')),
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await expect(client.listRepoLabels('foo/bar')).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.REQUEST_FAILED,
      });
    });

    it('Octokit null → TOKEN_NOT_CONFIGURED', async () => {
      const client = new OctokitGithubClient(null);
      await expect(client.listRepoLabels('foo/bar')).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.TOKEN_NOT_CONFIGURED,
      });
    });
  });

  describe('listAuthorMergedPullRequestsSince — state/updatedAt 필드 확장', () => {
    it('머지 PR 에 state="merged" + updatedAt + mergedAt 채움', async () => {
      const search = jest.fn().mockResolvedValue({
        data: {
          items: [
            {
              number: 10,
              repository_url: 'https://api.github.com/repos/foo/bar',
            },
          ],
        },
      });
      const prGet = jest.fn().mockResolvedValue({
        data: {
          title: 'feat: something',
          body: 'body',
          html_url: 'https://github.com/foo/bar/pull/10',
          merged_at: '2026-06-01T10:00:00Z',
          updated_at: '2026-06-01T11:00:00Z',
          additions: 5,
          deletions: 2,
          changed_files: 1,
        },
      });
      const octokit = {
        rest: {
          search: { issuesAndPullRequests: search },
          pulls: { get: prGet },
        },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      const results = await client.listAuthorMergedPullRequestsSince({
        repo: 'foo/bar',
        author: 'JSL107',
        sinceIsoDate: '2026-05-01',
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].state).toBe('merged');
      expect(results[0].mergedAt).toBe('2026-06-01T10:00:00Z');
      expect(results[0].updatedAt).toBe('2026-06-01T11:00:00Z');
    });
  });

  describe('listAuthorOpenPullRequests — open PR 조회', () => {
    const buildOpenOctokit = ({
      searchItems,
      prData,
    }: {
      searchItems: Array<{ number: number; repository_url: string }>;
      prData: Record<string, unknown>;
    }): { octokit: Octokit; search: jest.Mock; prGet: jest.Mock } => {
      const search = jest.fn().mockResolvedValue({
        data: { items: searchItems },
      });
      const prGet = jest.fn().mockResolvedValue({ data: prData });
      const octokit = {
        rest: {
          search: { issuesAndPullRequests: search },
          pulls: { get: prGet },
        },
      } as unknown as Octokit;
      return { octokit, search, prGet };
    };

    it('is:open author: 쿼리로 검색하고 state="open" + mergedAt=null + updatedAt 채움', async () => {
      const { octokit, search } = buildOpenOctokit({
        searchItems: [
          {
            number: 42,
            repository_url: 'https://api.github.com/repos/foo/bar',
          },
        ],
        prData: {
          title: 'feat: wip',
          body: 'WIP body',
          html_url: 'https://github.com/foo/bar/pull/42',
          merged_at: null,
          updated_at: '2026-06-08T09:00:00Z',
          additions: 30,
          deletions: 5,
          changed_files: 3,
        },
      });
      const client = new OctokitGithubClient(octokit);

      const results = await client.listAuthorOpenPullRequests({
        repo: 'foo/bar',
        author: 'JSL107',
        sinceIsoDate: '2026-06-01',
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].state).toBe('open');
      expect(results[0].mergedAt).toBeNull();
      expect(results[0].updatedAt).toBe('2026-06-08T09:00:00Z');
      expect(results[0].number).toBe(42);
      expect(results[0].title).toBe('feat: wip');
      // search 쿼리에 is:open + draft:false 포함 확인 (draft 노이즈 제외)
      const queryArg = search.mock.calls[0][0].q as string;
      expect(queryArg).toContain('is:open');
      expect(queryArg).toContain('draft:false');
      expect(queryArg).toContain('author:JSL107');
    });

    it('repo=null 이면 repo: 한정 없이 author 전체 검색', async () => {
      const { octokit, search } = buildOpenOctokit({
        searchItems: [
          {
            number: 7,
            repository_url: 'https://api.github.com/repos/other/repo',
          },
        ],
        prData: {
          title: 'fix: something',
          body: '',
          html_url: 'https://github.com/other/repo/pull/7',
          merged_at: null,
          updated_at: '2026-06-07T00:00:00Z',
          additions: 1,
          deletions: 0,
          changed_files: 1,
        },
      });
      const client = new OctokitGithubClient(octokit);

      await client.listAuthorOpenPullRequests({
        repo: null,
        author: 'JSL107',
        sinceIsoDate: '2026-06-01',
        limit: 10,
      });

      const queryArg = search.mock.calls[0][0].q as string;
      expect(queryArg).not.toContain('repo:');
    });

    it('search 실패 시 REQUEST_FAILED 예외', async () => {
      const search = jest.fn().mockRejectedValue(new Error('network error'));
      const octokit = {
        rest: {
          search: { issuesAndPullRequests: search },
          pulls: { get: jest.fn() },
        },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await expect(
        client.listAuthorOpenPullRequests({
          repo: 'foo/bar',
          author: 'JSL107',
          sinceIsoDate: '2026-06-01',
          limit: 10,
        }),
      ).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.REQUEST_FAILED,
      });
    });

    it('Octokit null 이면 TOKEN_NOT_CONFIGURED', async () => {
      const client = new OctokitGithubClient(null);

      await expect(
        client.listAuthorOpenPullRequests({
          repo: 'foo/bar',
          author: 'JSL107',
          sinceIsoDate: '2026-06-01',
          limit: 10,
        }),
      ).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.TOKEN_NOT_CONFIGURED,
      });
    });

    it('검색 후 머지된 PR(merged_at 존재)은 결과에서 skip (race 중복 방지)', async () => {
      const { octokit } = buildOpenOctokit({
        searchItems: [
          {
            number: 42,
            repository_url: 'https://api.github.com/repos/foo/bar',
          },
        ],
        prData: {
          title: 'feat: just merged between search and get',
          body: '',
          html_url: 'https://github.com/foo/bar/pull/42',
          merged_at: '2026-06-09T00:00:00Z', // is:open 검색 후 상세 조회 사이 머지됨
          updated_at: '2026-06-09T00:00:00Z',
          additions: 1,
          deletions: 0,
          changed_files: 1,
        },
      });
      const client = new OctokitGithubClient(octokit);

      const results = await client.listAuthorOpenPullRequests({
        repo: 'foo/bar',
        author: 'JSL107',
        sinceIsoDate: '2026-06-01',
        limit: 10,
      });

      // merged_at 이 채워지면 merged 결과셋과 중복되므로 open 결과에서 제외.
      expect(results).toHaveLength(0);
    });
  });

  describe('addLabelsToIssue — issues.opened 자동 라벨링 apply', () => {
    it('labels 비어 있으면 호출 자체 skip (network noop)', async () => {
      const addLabels = jest.fn();
      const octokit = {
        rest: { issues: { addLabels } },
        paginate: jest.fn(),
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await client.addLabelsToIssue({
        repo: 'foo/bar',
        issueNumber: 42,
        labels: [],
      });
      expect(addLabels).not.toHaveBeenCalled();
    });

    it('labels 가 있으면 owner/repo/issue_number/labels 전달', async () => {
      const addLabels = jest.fn().mockResolvedValue(undefined);
      const octokit = {
        rest: { issues: { addLabels } },
        paginate: jest.fn(),
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await client.addLabelsToIssue({
        repo: 'foo/bar',
        issueNumber: 42,
        labels: ['bug', 'docs'],
      });
      expect(addLabels).toHaveBeenCalledWith({
        owner: 'foo',
        repo: 'bar',
        issue_number: 42,
        labels: ['bug', 'docs'],
      });
    });

    it('addLabels throw 시 REQUEST_FAILED 로 감싼다', async () => {
      const addLabels = jest.fn().mockRejectedValue(
        new GithubException({
          code: GithubErrorCode.REQUEST_FAILED,
          message: 'forbidden',
        }),
      );
      const octokit = {
        rest: { issues: { addLabels } },
        paginate: jest.fn(),
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await expect(
        client.addLabelsToIssue({
          repo: 'foo/bar',
          issueNumber: 42,
          labels: ['bug'],
        }),
      ).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.REQUEST_FAILED,
      });
    });
  });
});
