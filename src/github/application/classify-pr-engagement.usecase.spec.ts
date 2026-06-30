import { GithubClientPort } from '../domain/port/github-client.port';
import { ClassifyPullRequestEngagementUsecase } from './classify-pr-engagement.usecase';

const pr = (n: number) => ({
  number: n,
  title: `PR${n}`,
  repo: 'o/r',
  url: `https://x/${n}`,
  draft: false,
  updatedAt: '',
  requestedReviewers: [],
  isApproved: false,
});

describe('ClassifyPullRequestEngagementUsecase', () => {
  it('WAITING 신호는 waitingItems 로, 나머지는 activePullRequests 로 분리', async () => {
    const client = {
      fetchPullRequestEngagement: jest.fn().mockResolvedValue([
        {
          repo: 'o/r',
          number: 1,
          title: 'PR1',
          url: 'https://x/1',
          isApproved: true,
          iAmAuthor: false,
          iAmRequestedReviewer: false,
          iRequestedChanges: false,
          iActedRecently: false,
          mergeableState: 'clean',
        },
        {
          repo: 'o/r',
          number: 2,
          title: 'PR2',
          url: 'https://x/2',
          isApproved: false,
          iAmAuthor: false,
          iAmRequestedReviewer: true,
          iRequestedChanges: false,
          iActedRecently: false,
          mergeableState: 'blocked',
        },
      ]),
    };
    const usecase = new ClassifyPullRequestEngagementUsecase(
      client as unknown as GithubClientPort,
    );
    const result = await usecase.execute([pr(1), pr(2)]);
    expect(result.waitingItems).toHaveLength(1);
    expect(result.waitingItems[0].title).toBe('PR1');
    expect(result.activePullRequests.map((p) => p.number)).toEqual([2]);
  });

  it('신호 누락 PR 은 ACTIVE 로 보존 (signal 매칭 실패 graceful)', async () => {
    const client = {
      fetchPullRequestEngagement: jest.fn().mockResolvedValue([]),
    };
    const usecase = new ClassifyPullRequestEngagementUsecase(
      client as unknown as GithubClientPort,
    );
    const result = await usecase.execute([pr(1)]);
    expect(result.activePullRequests).toHaveLength(1);
    expect(result.waitingItems).toHaveLength(0);
  });
});
