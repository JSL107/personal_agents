import { Octokit } from '@octokit/rest';

import { GithubErrorCode } from '../domain/github-error-code.enum';
import { GithubException } from '../domain/github.exception';
import { OctokitGithubClient } from './octokit-github.client';

describe('OctokitGithubClient', () => {
  const buildOctokitMock = (items: Array<Record<string, unknown>>): Octokit =>
    ({
      rest: {
        search: {
          issuesAndPullRequests: jest
            .fn()
            .mockResolvedValue({ data: { items } }),
        },
      },
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
        pages: [huge.slice(0, 100), huge.slice(100, 200), huge.slice(200, 300), huge.slice(300, 400), huge.slice(400, 500), huge.slice(500, 600)],
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
});
