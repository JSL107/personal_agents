import { Octokit } from '@octokit/rest';

import { classifyAuthorPullRequestTurn } from '../domain/classify-author-pr-turn';
import { OctokitGithubClient } from './octokit-github.client';

describe('내 PR 신호 조회', () => {
  it('서로 다른 두 사람이 수정 요청하고 마지막 요청자만 재요청되면 내 차례다', async () => {
    const client = new OctokitGithubClient({
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({
            data: {
              state: 'open',
              draft: false,
              mergeable_state: 'unknown',
              requested_reviewers: [{ login: 'bob' }],
              requested_teams: [],
            },
          }),
          listReviews: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue([
        {
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-01-01',
          user: { login: 'alice', type: 'User' },
        },
        {
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-01-02',
          user: { login: 'bob', type: 'User' },
        },
      ]),
    } as unknown as Octokit);

    const [signals] = await client.fetchAuthorPullRequestSignals([
      { repo: 'o/r', number: 1 },
    ]);

    expect(signals.changesRequestedBy).toEqual(['alice', 'bob']);
    expect(classifyAuthorPullRequestTurn(signals)).toEqual({
      turn: 'MY_TURN',
      reason: '수정 요청 받음',
    });
  });

  it('팀 slug와 사람의 최신 결정 리뷰를 수집한다', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        state: 'open',
        draft: false,
        mergeable_state: 'clean',
        requested_reviewers: [{ login: 'alice' }],
        requested_teams: [{ slug: 'team' }],
      },
    });
    const listReviews = jest.fn();
    const paginate = jest.fn().mockResolvedValue([
      {
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-01-01',
        user: { login: 'bob', type: 'User' },
      },
      {
        state: 'APPROVED',
        submitted_at: '2026-01-02',
        user: { login: 'bob', type: 'User' },
      },
      {
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-01-03',
        user: { login: 'bot', type: 'Bot' },
      },
      {
        state: 'CHANGES_REQUESTED',
        submitted_at: '2026-01-04',
        user: { login: 'carol', type: 'User' },
      },
    ]);
    const client = new OctokitGithubClient({
      rest: { pulls: { get, listReviews } },
      paginate,
    } as unknown as Octokit);
    expect(
      await client.fetchAuthorPullRequestSignals([{ repo: 'o/r', number: 1 }]),
    ).toEqual([
      {
        ref: { repo: 'o/r', number: 1 },
        open: true,
        draft: false,
        mergeableState: 'clean',
        isApproved: false,
        pendingReviewers: ['alice', 'team'],
        changesRequestedBy: ['carol'],
        observed: true,
      },
    ]);
  });
  it('pulls.get state=closed를 닫힌 PR로 전달한다', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        state: 'closed',
        draft: false,
        mergeable_state: 'unknown',
        requested_reviewers: [],
        requested_teams: [],
      },
    });
    const client = new OctokitGithubClient({
      rest: { pulls: { get, listReviews: jest.fn() } },
      paginate: jest.fn().mockResolvedValue([]),
    } as unknown as Octokit);
    const [result] = await client.fetchAuthorPullRequestSignals([
      { repo: 'o/r', number: 1 },
    ]);
    expect(result.open).toBe(false);
  });
  it('실패 및 상한 초과는 입력 순서를 지키며 미관측 처리한다', async () => {
    const get = jest.fn().mockRejectedValue(new Error('failed'));
    const client = new OctokitGithubClient({
      rest: { pulls: { get } },
    } as unknown as Octokit);
    const refs = Array.from({ length: 31 }, (_, index) => ({
      repo: 'o/r',
      number: index + 1,
    }));
    const result = await client.fetchAuthorPullRequestSignals(refs);
    expect(result.map((signal) => signal.ref)).toEqual(refs);
    expect(result.every((signal) => !signal.observed)).toBe(true);
    expect(get).toHaveBeenCalledTimes(30);
  });
});
