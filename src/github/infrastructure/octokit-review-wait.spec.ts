import { Octokit } from '@octokit/rest';

import { OctokitGithubClient } from './octokit-github.client';

const ref = { repo: 'owner/repo', number: 42 };

describe('OctokitGithubClient.fetchReviewWaits', () => {
  it('대상 리뷰어의 마지막 review_requested 만 쓰고 팀 slug 도 맞춘다', async () => {
    const listEventsForTimeline = jest.fn();
    const paginate = jest.fn().mockResolvedValue([
      {
        event: 'review_requested',
        created_at: '2026-11-01T00:00:00Z',
        requested_reviewer: { login: 'alice' },
      },
      {
        event: 'commented',
        created_at: '2026-11-01T12:00:00Z',
        user: { login: 'alice' },
      },
      {
        event: 'review_requested',
        created_at: '2026-11-02T00:00:00Z',
        requested_reviewer: { login: 'alice' },
      },
      {
        event: 'review_requested',
        created_at: '2026-11-03T00:00:00Z',
        requested_team: { slug: 'backend', name: 'Backend Team' },
      },
      {
        event: 'review_requested',
        created_at: '2026-11-03T12:00:00Z',
        requested_reviewer: { login: 'charlie' },
      },
    ]);
    const client = new OctokitGithubClient({
      rest: { issues: { listEventsForTimeline } },
      paginate,
    } as unknown as Octokit);

    const result = await client.fetchReviewWaits([
      { ref, pendingReviewers: ['alice', 'backend'] },
    ]);

    expect(result).toEqual([
      {
        ref,
        complete: true,
        waits: [
          { reviewer: 'alice', requestedAt: '2026-11-02T00:00:00Z' },
          { reviewer: 'backend', requestedAt: '2026-11-03T00:00:00Z' },
        ],
      },
    ]);
    expect(paginate).toHaveBeenCalledWith(listEventsForTimeline, {
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      per_page: 100,
    });
  });

  it('타임라인 조회가 실패하면 그 PR은 complete=false 로 돌려준다', async () => {
    const client = new OctokitGithubClient({
      rest: { issues: { listEventsForTimeline: jest.fn() } },
      paginate: jest.fn().mockRejectedValue(new Error('rate limit')),
    } as unknown as Octokit);

    await expect(
      client.fetchReviewWaits([{ ref, pendingReviewers: ['alice'] }]),
    ).resolves.toEqual([{ ref, complete: false, waits: [] }]);
  });
});
