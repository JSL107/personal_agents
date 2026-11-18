import { Octokit } from '@octokit/rest';

import { QUIET_PR_DAYS } from '../../schedule/domain/daily-todo.constant';
import { classifyAuthorPullRequestTurn } from '../domain/classify-author-pr-turn';
import { describeQuietPullRequest } from '../domain/review-wait';
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

describe('내 마지막 활동 시각', () => {
  const now = new Date('2026-11-18T00:00:00Z');
  const build = ({
    pushes = [],
    timeline = [],
    hasPreviousPage = false,
    reviews = [],
    updatedAt = '2026-11-17T23:06:27Z',
  }: {
    pushes?: Array<{ timestamp: string; activity_type: string }>;
    timeline?: Array<Record<string, unknown>>;
    hasPreviousPage?: boolean;
    reviews?: Array<Record<string, unknown>>;
    updatedAt?: string;
  }) => {
    const request = jest.fn().mockResolvedValue({ data: pushes });
    const graphql = jest.fn().mockResolvedValue({
      repository: {
        pullRequest: {
          timelineItems: { nodes: timeline, pageInfo: { hasPreviousPage } },
        },
      },
    });
    const client = new OctokitGithubClient({
      rest: {
        users: {
          getAuthenticated: jest
            .fn()
            .mockResolvedValue({ data: { login: 'token-owner' } }),
        },
        pulls: {
          get: jest.fn().mockResolvedValue({
            data: {
              user: { login: 'me' },
              state: 'open',
              draft: false,
              mergeable_state: 'clean',
              requested_reviewers: [],
              requested_teams: [],
              created_at: '2026-10-20T00:00:00Z',
              updated_at: updatedAt,
              head: { ref: 'feat/x', repo: { full_name: 'fork/r' } },
            },
          }),
          listReviews: jest.fn(),
        },
      },
      paginate: jest.fn().mockResolvedValue(reviews),
      request,
      graphql,
    } as unknown as Octokit);
    return { client, request, graphql };
  };
  const fetchLatest = async (client: OctokitGithubClient) => {
    const [signal] = await client.fetchAuthorPullRequestSignals([
      { repo: 'o/r', number: 4704 },
    ]);
    return signal;
  };

  it('남이 일으킨 갱신만 최근에 있으면 updatedAt 이 아니라 내 마지막 활동으로 멈춤을 판정한다 (spinoff#4704)', async () => {
    const { client, graphql } = build({
      pushes: [{ timestamp: '2026-10-25T08:00:00Z', activity_type: 'push' }],
      timeline: [
        { createdAt: '2026-10-26T09:00:19Z', author: { login: 'me' } },
        { createdAt: '2026-10-26T09:00:21Z', actor: { login: 'me' } },
        {
          createdAt: '2026-11-10T00:00:00Z',
          author: { login: 'gemini-code-assist' },
        },
      ],
    });

    const signal = await fetchLatest(client);

    expect(signal.observed).toBe(true);
    expect(signal.lastAuthorActivityAt).toBe('2026-10-26T09:00:21Z');
    // cross-reference 는 내가 일으켜도 움직임이 아니다 — 조회 대상에서 뺀다.
    const [query] = graphql.mock.calls[0] as [string];
    expect(query).not.toContain('CROSS_REFERENCED');
    expect(
      describeQuietPullRequest({
        updatedAts: [signal.lastAuthorActivityAt],
        minDays: QUIET_PR_DAYS,
        now,
      }),
    ).toEqual({ label: '23일째 움직임 없음', days: 23 });
  });

  it('최근 push 가 있으면 커밋 시각과 무관하게 움직임이다 (puppeteer#52)', async () => {
    const { client, request } = build({
      pushes: [
        { timestamp: '2026-11-16T08:45:46Z', activity_type: 'push' },
        { timestamp: '2026-11-16T07:15:50Z', activity_type: 'pr_merge' },
      ],
    });

    const signal = await fetchLatest(client);

    expect(signal.lastAuthorActivityAt).toBe('2026-11-16T08:45:46Z');
    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/activity', {
      owner: 'fork',
      repo: 'r',
      ref: 'refs/heads/feat/x',
      actor: 'me',
      per_page: 100,
    });
    expect(
      describeQuietPullRequest({
        updatedAts: [signal.lastAuthorActivityAt],
        minDays: QUIET_PR_DAYS,
        now,
      }),
    ).toBeNull();
  });

  it('리뷰 스레드 답글(내 COMMENTED 리뷰)도 내 활동으로 센다', async () => {
    const { client } = build({
      reviews: [
        {
          state: 'COMMENTED',
          submitted_at: '2026-11-17T02:42:26Z',
          user: { login: 'me', type: 'User' },
        },
        {
          state: 'COMMENTED',
          submitted_at: '2026-11-17T05:00:00Z',
          user: { login: 'alice', type: 'User' },
        },
      ],
    });

    expect((await fetchLatest(client)).lastAuthorActivityAt).toBe(
      '2026-11-17T02:42:26Z',
    );
  });

  it('내 흔적이 없고 더 오래된 타임라인이 남아 있으면 판정을 보류한다', async () => {
    const { client } = build({
      timeline: [
        { createdAt: '2026-11-01T00:00:00Z', author: { login: 'bob' } },
      ],
      hasPreviousPage: true,
    });

    const signal = await fetchLatest(client);

    expect(signal.observed).toBe(true);
    expect(signal.lastAuthorActivityAt).toBeUndefined();
  });

  it('활동 조회가 실패하면 차례 신호는 살리고 활동 시각만 비운다', async () => {
    const { client, graphql } = build({});
    graphql.mockRejectedValue(new Error('graphql down'));

    const signal = await fetchLatest(client);

    expect(signal.observed).toBe(true);
    expect(signal.mergeableState).toBe('clean');
    expect(signal.lastAuthorActivityAt).toBeUndefined();
  });
});
