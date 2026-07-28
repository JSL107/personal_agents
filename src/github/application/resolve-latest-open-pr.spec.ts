import { GithubClientPort } from '../domain/port/github-client.port';
import { resolveLatestOpenPrRef } from './resolve-latest-open-pr';

describe('resolveLatestOpenPrRef', () => {
  const input = {
    author: 'JSL107',
    repo: 'JSL107/personal_agents',
    sinceIsoDate: '2026-01-01',
  };

  it('여러 open PR 중 첫 항목만 prRef + notice 로 반환한다', async () => {
    const githubClient = {
      listAuthorOpenPullRequests: jest.fn().mockResolvedValue([
        {
          repo: 'JSL107/personal_agents',
          number: 42,
          title: '콘솔 리모컨',
          state: 'open',
          url: 'u',
          body: '',
          mergedAt: null,
          updatedAt: '2026-07-27',
          additions: 1,
          deletions: 0,
          changedFilesCount: 1,
        },
        {
          repo: 'JSL107/personal_agents',
          number: 41,
          title: '이전 PR',
          state: 'open',
          url: 'previous-url',
          body: '',
          mergedAt: null,
          updatedAt: '2026-07-26',
          additions: 1,
          deletions: 0,
          changedFilesCount: 1,
        },
      ]),
    } as unknown as GithubClientPort;

    const result = await resolveLatestOpenPrRef(githubClient, input);

    expect(result).toEqual({
      prRef: 'JSL107/personal_agents#42',
      notice:
        'PR 미지정 → 최근 open PR JSL107/personal_agents#42 자동 선택: 콘솔 리모컨',
    });
    expect(githubClient.listAuthorOpenPullRequests).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents',
      author: 'JSL107',
      sinceIsoDate: '2026-01-01',
      limit: 1,
    });
  });

  it('open PR 이 없으면 null 을 반환한다', async () => {
    const githubClient = {
      listAuthorOpenPullRequests: jest.fn().mockResolvedValue([]),
    } as unknown as GithubClientPort;

    await expect(
      resolveLatestOpenPrRef(githubClient, input),
    ).resolves.toBeNull();
  });
});
