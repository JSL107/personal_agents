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

  // 힌트 사전이 실제로 이 경로를 지나는지 — 겨냥한 조건(Octokit RequestError)에서 확인한다.
  it('GitHub 이 404 를 주면 실패 문구에 다음 행동이 붙는다', async () => {
    const notFound = Object.assign(new Error('Not Found'), {
      name: 'HttpError',
      status: 404,
    });
    const octokit = {
      rest: {
        search: {
          issuesAndPullRequests: jest.fn().mockRejectedValue(notFound),
        },
        pulls: { listReviews: jest.fn() },
      },
      paginate: jest.fn().mockResolvedValue([]),
    } as unknown as Octokit;
    const client = new OctokitGithubClient(octokit);

    await expect(client.listMyAssignedTasks()).rejects.toMatchObject({
      githubErrorCode: GithubErrorCode.REQUEST_FAILED,
      message: expect.stringContaining('repo'),
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
          merged_at: '2026-06-01T10:00:00Z',
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
        mergedAt: '2026-06-01T10:00:00Z',
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

    it('untilIsoDate 지정 시 merged 기간 범위 쿼리를 사용한다', async () => {
      const search = jest.fn().mockResolvedValue({ data: { items: [] } });
      const client = new OctokitGithubClient({
        rest: {
          search: { issuesAndPullRequests: search },
          pulls: { get: jest.fn() },
        },
      } as unknown as Octokit);

      await client.listAuthorMergedPullRequestsSince({
        repo: 'foo/bar',
        author: 'JSL107',
        sinceIsoDate: '2026-08-10T15:00:00.000Z',
        untilIsoDate: '2026-08-11T15:00:00.000Z',
        limit: 10,
      });

      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'repo:foo/bar is:pr is:merged author:JSL107 merged:2026-08-10T15:00:00.000Z..2026-08-11T15:00:00.000Z',
        }),
      );
    });

    it('untilIsoDate 미지정 시 기존 merged 하한 쿼리를 유지한다', async () => {
      const search = jest.fn().mockResolvedValue({ data: { items: [] } });
      const client = new OctokitGithubClient({
        rest: {
          search: { issuesAndPullRequests: search },
          pulls: { get: jest.fn() },
        },
      } as unknown as Octokit);

      await client.listAuthorMergedPullRequestsSince({
        repo: 'foo/bar',
        author: 'JSL107',
        sinceIsoDate: '2026-08-10T15:00:00.000Z',
        limit: 10,
      });

      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'repo:foo/bar is:pr is:merged author:JSL107 merged:>=2026-08-10T15:00:00.000Z',
        }),
      );
    });

    it('throwOnDetailFailure=true 이고 상세 조회가 실패하면 실패/전체 건수와 함께 예외를 던진다', async () => {
      const search = jest.fn().mockResolvedValue({
        data: {
          items: [
            {
              number: 10,
              repository_url: 'https://api.github.com/repos/foo/bar',
            },
            {
              number: 11,
              repository_url: 'https://api.github.com/repos/foo/bar',
            },
          ],
        },
      });
      const prGet = jest
        .fn()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({
          data: {
            title: 'success',
            body: '',
            html_url: 'https://github.com/foo/bar/pull/11',
            merged_at: '2026-08-11T04:00:00Z',
            updated_at: '2026-08-11T04:00:00Z',
            additions: 1,
            deletions: 0,
            changed_files: 1,
          },
        });
      const client = new OctokitGithubClient({
        rest: {
          search: { issuesAndPullRequests: search },
          pulls: { get: prGet },
        },
      } as unknown as Octokit);

      await expect(
        client.listAuthorMergedPullRequestsSince({
          repo: 'foo/bar',
          author: 'JSL107',
          sinceIsoDate: '2026-08-10T15:00:00.000Z',
          limit: 10,
          throwOnDetailFailure: true,
        }),
      ).rejects.toThrow('머지 PR 상세 조회 1/2건 실패');
    });

    it('throwOnDetailFailure 미지정이면 상세 조회 실패분만 제외하고 정상 반환한다', async () => {
      const search = jest.fn().mockResolvedValue({
        data: {
          items: [
            {
              number: 10,
              repository_url: 'https://api.github.com/repos/foo/bar',
            },
            {
              number: 11,
              repository_url: 'https://api.github.com/repos/foo/bar',
            },
          ],
        },
      });
      const prGet = jest
        .fn()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({
          data: {
            title: 'success',
            body: '',
            html_url: 'https://github.com/foo/bar/pull/11',
            merged_at: '2026-08-11T04:00:00Z',
            updated_at: '2026-08-11T04:00:00Z',
            additions: 1,
            deletions: 0,
            changed_files: 1,
          },
        });
      const client = new OctokitGithubClient({
        rest: {
          search: { issuesAndPullRequests: search },
          pulls: { get: prGet },
        },
      } as unknown as Octokit);

      const results = await client.listAuthorMergedPullRequestsSince({
        repo: 'foo/bar',
        author: 'JSL107',
        sinceIsoDate: '2026-08-10T15:00:00.000Z',
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].number).toBe(11);
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

  describe('fetchPullRequestEngagement', () => {
    it('clean + 내 승인 리뷰 → isApproved=true, mergeableState=clean', async () => {
      const octokit = {
        rest: {
          users: {
            getAuthenticated: jest
              .fn()
              .mockResolvedValue({ data: { login: 'me' } }),
          },
          pulls: {
            get: jest.fn().mockResolvedValue({
              data: {
                user: { login: 'author' },
                requested_reviewers: [],
                draft: false,
                mergeable_state: 'clean',
              },
            }),
            listReviews: jest.fn(),
          },
          issues: { listComments: jest.fn().mockResolvedValue({ data: [] }) },
        },
        paginate: jest.fn().mockResolvedValue([
          {
            state: 'APPROVED',
            submitted_at: '2026-06-30T00:00:00Z',
            user: { id: 1, login: 'me' },
          },
        ]),
      };
      const client = new OctokitGithubClient(octokit as unknown as Octokit);
      const [s] = await client.fetchPullRequestEngagement([
        {
          number: 1,
          title: 't',
          repo: 'o/r',
          url: 'u',
          draft: false,
          updatedAt: '',
          requestedReviewers: [],
          isApproved: false,
        },
      ]);
      expect(s.isApproved).toBe(true);
      expect(s.mergeableState).toBe('clean');
      expect(s.iAmAuthor).toBe(false);
    });

    it('pulls.get 실패 → 중립 신호(unknown, flag false)로 graceful', async () => {
      const octokit = {
        rest: {
          users: {
            getAuthenticated: jest
              .fn()
              .mockResolvedValue({ data: { login: 'me' } }),
          },
          pulls: {
            get: jest.fn().mockRejectedValue(new Error('boom')),
            listReviews: jest.fn(),
          },
          issues: { listComments: jest.fn() },
        },
        paginate: jest.fn().mockResolvedValue([]),
      };
      const client = new OctokitGithubClient(octokit as unknown as Octokit);
      const [s] = await client.fetchPullRequestEngagement([
        {
          number: 1,
          title: 't',
          repo: 'o/r',
          url: 'u',
          draft: false,
          updatedAt: '',
          requestedReviewers: [],
          isApproved: false,
        },
      ]);
      expect(s.mergeableState).toBe('unknown');
      expect(s.isApproved).toBe(false);
      expect(s.iActedRecently).toBe(false);
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

  describe('createReviewComment', () => {
    it('line 이 있으면 줄 단위로 게시하고 id·nodeId 를 반환한다', async () => {
      const createReviewComment = jest.fn().mockResolvedValue({
        data: { id: 555, node_id: 'PRRC_abc' },
      });
      const octokit = {
        rest: { pulls: { createReviewComment } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      const result = await client.createReviewComment({
        repo: 'JSL107/personal_agents',
        pullNumber: 180,
        commitSha: 'abc1234',
        filePath: 'src/foo.service.ts',
        line: 42,
        body: '트랜잭션 밖에서 저장한다',
      });

      expect(createReviewComment).toHaveBeenCalledWith({
        owner: 'JSL107',
        repo: 'personal_agents',
        pull_number: 180,
        commit_id: 'abc1234',
        path: 'src/foo.service.ts',
        body: '트랜잭션 밖에서 저장한다',
        line: 42,
        side: 'RIGHT',
      });
      expect(result).toEqual({ commentId: '555', nodeId: 'PRRC_abc' });
    });

    it('line 이 null 이면 파일 단위(subject_type=file)로 게시한다', async () => {
      const createReviewComment = jest.fn().mockResolvedValue({
        data: { id: 556, node_id: 'PRRC_def' },
      });
      const octokit = {
        rest: { pulls: { createReviewComment } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await client.createReviewComment({
        repo: 'JSL107/personal_agents',
        pullNumber: 180,
        commitSha: 'abc1234',
        filePath: 'src/foo.service.ts',
        line: null,
        body: '본문',
      });

      expect(createReviewComment).toHaveBeenCalledWith({
        owner: 'JSL107',
        repo: 'personal_agents',
        pull_number: 180,
        commit_id: 'abc1234',
        path: 'src/foo.service.ts',
        body: '본문',
        subject_type: 'file',
      });
    });

    it('API 실패는 GithubException 으로 감싼다', async () => {
      const createReviewComment = jest
        .fn()
        .mockRejectedValue(new Error('422 Unprocessable Entity'));
      const octokit = {
        rest: { pulls: { createReviewComment } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await expect(
        client.createReviewComment({
          repo: 'JSL107/personal_agents',
          pullNumber: 180,
          commitSha: 'abc1234',
          filePath: 'src/foo.service.ts',
          line: 42,
          body: '본문',
        }),
      ).rejects.toThrow('인라인 리뷰 코멘트 게시 실패');
    });

    it('Octokit 이 없으면 TOKEN_NOT_CONFIGURED 예외', async () => {
      const client = new OctokitGithubClient(null);

      await expect(
        client.createReviewComment({
          repo: 'JSL107/personal_agents',
          pullNumber: 180,
          commitSha: 'abc1234',
          filePath: 'src/foo.service.ts',
          line: 42,
          body: '본문',
        }),
      ).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.TOKEN_NOT_CONFIGURED,
      });
    });
  });

  describe('listReviewThreads', () => {
    it('GraphQL 스레드·코멘트·리액션을 포트 타입으로 매핑한다', async () => {
      const graphql = jest.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            author: { login: 'pr-author' },
            state: 'OPEN',
            merged: false,
            reviewThreads: {
              nodes: [
                {
                  id: 'PRRT_thread',
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        databaseId: 555,
                        body: '리뷰 본문',
                        createdAt: '2026-07-31T00:00:00Z',
                        author: { login: 'idaeri-bot' },
                        reactions: {
                          nodes: [
                            {
                              content: 'THUMBS_UP',
                              createdAt: '2026-07-31T01:00:00Z',
                              user: { login: 'owner' },
                            },
                          ],
                          pageInfo: { hasNextPage: false },
                        },
                      },
                    ],
                    pageInfo: { hasNextPage: false },
                  },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      });
      const client = new OctokitGithubClient({
        graphql,
      } as unknown as Octokit);

      const result = await client.listReviewThreads({
        repo: 'JSL107/personal_agents',
        number: 180,
      });

      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining(
          'pullRequest(number:$number) {\n        author { login }',
        ),
        { owner: 'JSL107', name: 'personal_agents', number: 180 },
      );
      expect(result).toEqual({
        pullRequestAuthorLogin: 'pr-author',
        pullRequestState: 'OPEN',
        truncated: false,
        threads: [
          {
            threadId: 'PRRT_thread',
            isResolved: false,
            comments: [
              {
                databaseId: 555,
                authorLogin: 'idaeri-bot',
                body: '리뷰 본문',
                createdAt: '2026-07-31T00:00:00Z',
                reactions: [
                  {
                    content: 'THUMBS_UP',
                    userLogin: 'owner',
                    createdAt: '2026-07-31T01:00:00Z',
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    it('merged=true면 GraphQL state보다 MERGED를 우선한다', async () => {
      const graphql = jest.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            author: { login: 'pr-author' },
            state: 'CLOSED',
            merged: true,
            reviewThreads: {
              nodes: [],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      });
      const client = new OctokitGithubClient({
        graphql,
      } as unknown as Octokit);

      const result = await client.listReviewThreads({
        repo: 'foo/bar',
        number: 1,
      });

      expect(result.pullRequestState).toBe('MERGED');
    });

    it('삭제된 PR 작성자는 null로 보존한다', async () => {
      const graphql = jest.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            author: null,
            state: 'OPEN',
            merged: false,
            reviewThreads: {
              nodes: [],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      });
      const client = new OctokitGithubClient({
        graphql,
      } as unknown as Octokit);

      const result = await client.listReviewThreads({
        repo: 'foo/bar',
        number: 1,
      });

      expect(result.pullRequestAuthorLogin).toBeNull();
    });

    it.each(['threads', 'comments', 'reactions'] as const)(
      '%s pagination이 남아 있으면 truncated=true를 반환한다',
      async (truncatedLevel) => {
        const graphql = jest.fn().mockResolvedValue({
          repository: {
            pullRequest: {
              author: { login: 'pr-author' },
              state: 'OPEN',
              merged: false,
              reviewThreads: {
                nodes: [
                  {
                    id: 'PRRT_thread',
                    isResolved: false,
                    comments: {
                      nodes: [
                        {
                          databaseId: 555,
                          body: '리뷰 본문',
                          createdAt: '2026-07-31T00:00:00Z',
                          author: { login: 'idaeri-bot' },
                          reactions: {
                            nodes: [],
                            pageInfo: {
                              hasNextPage: truncatedLevel === 'reactions',
                            },
                          },
                        },
                      ],
                      pageInfo: {
                        hasNextPage: truncatedLevel === 'comments',
                      },
                    },
                  },
                ],
                pageInfo: {
                  hasNextPage: truncatedLevel === 'threads',
                },
              },
            },
          },
        });
        const client = new OctokitGithubClient({
          graphql,
        } as unknown as Octokit);

        const result = await client.listReviewThreads({
          repo: 'foo/bar',
          number: 1,
        });

        expect(result.truncated).toBe(true);
      },
    );
  });

  describe('resolveReviewThread', () => {
    it('GraphQL mutation에 PRRT thread id를 전달한다', async () => {
      const graphql = jest.fn().mockResolvedValue({
        resolveReviewThread: { thread: { id: 'PRRT_thread' } },
      });
      const client = new OctokitGithubClient({
        graphql,
      } as unknown as Octokit);

      await client.resolveReviewThread('PRRT_thread');

      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('resolveReviewThread'),
        { threadId: 'PRRT_thread' },
      );
    });
  });

  describe('blog file publish', () => {
    it('commitFileToBranch — UTF-8 본문을 base64로 단 한 번 createOrUpdateFileContents 호출한다', async () => {
      const createOrUpdateFileContents = jest.fn().mockResolvedValue({
        data: {
          commit: { sha: 'commit-sha' },
          content: {
            html_url:
              'https://github.com/JSL107/JSL107.github.io/blob/main/src/content/posts/hello.md',
          },
        },
      });
      const client = new OctokitGithubClient({
        rest: { repos: { createOrUpdateFileContents } },
      } as unknown as Octokit);

      const result = await (
        client as unknown as {
          commitFileToBranch: (input: {
            repo: string;
            branch: string;
            path: string;
            content: string;
            commitMessage: string;
          }) => Promise<{ commitSha: string; fileUrl: string }>;
        }
      ).commitFileToBranch({
        repo: 'JSL107/JSL107.github.io',
        branch: 'main',
        path: 'src/content/posts/hello.md',
        content: '한글 본문',
        commitMessage: 'feat(blog): hello',
      });

      expect(createOrUpdateFileContents).toHaveBeenCalledTimes(1);
      expect(createOrUpdateFileContents).toHaveBeenCalledWith({
        owner: 'JSL107',
        repo: 'JSL107.github.io',
        branch: 'main',
        path: 'src/content/posts/hello.md',
        message: 'feat(blog): hello',
        content: Buffer.from('한글 본문', 'utf-8').toString('base64'),
      });
      expect(result).toEqual({
        commitSha: 'commit-sha',
        fileUrl:
          'https://github.com/JSL107/JSL107.github.io/blob/main/src/content/posts/hello.md',
      });
    });

    it('commitFileToBranch — sha 없이 생긴 422 충돌은 이미 발행된 경로로 안내한다', async () => {
      const createOrUpdateFileContents = jest.fn().mockRejectedValue({
        status: 422,
        message: 'Invalid request. "sha" wasn\'t supplied.',
      });
      const client = new OctokitGithubClient({
        rest: { repos: { createOrUpdateFileContents } },
      } as unknown as Octokit);

      await expect(
        (
          client as unknown as {
            commitFileToBranch: (input: {
              repo: string;
              branch: string;
              path: string;
              content: string;
              commitMessage: string;
            }) => Promise<unknown>;
          }
        ).commitFileToBranch({
          repo: 'JSL107/JSL107.github.io',
          branch: 'main',
          path: 'src/content/posts/hello.md',
          content: '본문',
          commitMessage: 'feat(blog): hello',
        }),
      ).rejects.toThrow('이미 발행된 경로');
      expect(createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.not.objectContaining({ sha: expect.anything() }),
      );
    });

    it('commitFileToBranch — 기존 파일 sha 누락을 response message로 확인한 422만 이미 발행된 경로로 변환한다', async () => {
      const createOrUpdateFileContents = jest.fn().mockRejectedValue({
        status: 422,
        message: 'Request failed',
        response: { data: { message: 'File already exists' } },
      });
      const client = new OctokitGithubClient({
        rest: { repos: { createOrUpdateFileContents } },
      } as unknown as Octokit);

      await expect(
        client.commitFileToBranch({
          repo: 'JSL107/JSL107.github.io',
          branch: 'main',
          path: 'src/content/posts/hello.md',
          content: '본문',
          commitMessage: 'feat(blog): hello',
        }),
      ).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.REQUEST_FAILED,
        status: 'CONFLICT',
      });
    });

    it('commitFileToBranch — 기존 파일 충돌 근거가 없는 422는 원인을 보존해 REQUEST_FAILED로 감싼다', async () => {
      const error = Object.assign(
        new Error('Validation Failed: branch is protected'),
        { status: 422 },
      );
      const createOrUpdateFileContents = jest.fn().mockRejectedValue(error);
      const client = new OctokitGithubClient({
        rest: { repos: { createOrUpdateFileContents } },
      } as unknown as Octokit);

      await expect(
        client.commitFileToBranch({
          repo: 'JSL107/JSL107.github.io',
          branch: 'main',
          path: 'src/content/posts/hello.md',
          content: '본문',
          commitMessage: 'feat(blog): hello',
        }),
      ).rejects.toThrow(
        'GitHub JSL107/JSL107.github.io 파일 커밋 실패 (main:src/content/posts/hello.md): Validation Failed: branch is protected',
      );
    });

    it('getFileFromBranch — branch의 파일을 재조회한다', async () => {
      const getContent = jest.fn().mockResolvedValue({
        data: {
          html_url:
            'https://github.com/JSL107/JSL107.github.io/blob/main/src/content/posts/hello.md',
        },
      });
      const client = new OctokitGithubClient({
        rest: { repos: { getContent } },
      } as unknown as Octokit);

      const result = await (
        client as unknown as {
          getFileFromBranch: (input: {
            repo: string;
            branch: string;
            path: string;
          }) => Promise<{ fileUrl: string }>;
        }
      ).getFileFromBranch({
        repo: 'JSL107/JSL107.github.io',
        branch: 'main',
        path: 'src/content/posts/hello.md',
      });

      expect(getContent).toHaveBeenCalledWith({
        owner: 'JSL107',
        repo: 'JSL107.github.io',
        path: 'src/content/posts/hello.md',
        ref: 'main',
      });
      expect(result.fileUrl).toContain('/hello.md');
    });

    // 본문은 주간 수정률 집계가 발행본과 대조하는 값이다. 디코딩이 어긋나면 글 전체가
    // 「바뀐 것」으로 잡혀 수정률이 100% 로 튄다.
    it('getFileFromBranch — base64 본문을 디코딩해 함께 돌려준다', async () => {
      const getContent = jest.fn().mockResolvedValue({
        data: {
          html_url: 'https://github.com/owner/repo/blob/main/a.md',
          encoding: 'base64',
          content: Buffer.from('첫 줄이에요.\n둘째 줄이에요.', 'utf8').toString(
            'base64',
          ),
        },
      });
      const client = new OctokitGithubClient({
        rest: { repos: { getContent } },
      } as unknown as Octokit);

      const result = await client.getFileFromBranch({
        repo: 'owner/repo',
        branch: 'main',
        path: 'a.md',
      });

      expect(result.content).toBe('첫 줄이에요.\n둘째 줄이에요.');
    });

    // GitHub 은 1MB 를 넘는 파일에 본문을 싣지 않고 encoding 을 'none' 으로 준다. 그때
    // base64 로 디코딩하면 빈 문자열이 「내용이 없는 파일」로 읽혀, 부르는 쪽이 그 글을
    // 「통째로 지워졌다」로 집계한다.
    it('getFileFromBranch — 본문이 실려 오지 않으면 content 를 넘기지 않는다', async () => {
      const getContent = jest.fn().mockResolvedValue({
        data: {
          html_url: 'https://github.com/owner/repo/blob/main/big.md',
          encoding: 'none',
          content: '',
        },
      });
      const client = new OctokitGithubClient({
        rest: { repos: { getContent } },
      } as unknown as Octokit);

      const result = await client.getFileFromBranch({
        repo: 'owner/repo',
        branch: 'main',
        path: 'big.md',
      });

      expect(result.content).toBeUndefined();
    });
  });
});
