import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import {
  AssignedTasks,
  GithubPullRequest,
} from '../../../github/domain/github.type';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import { SlackInboxService } from '../../../slack-inbox/application/slack-inbox.service';
import { DailyPlanContextCollector } from './daily-plan-context.collector';

const buildPr = (
  overrides: Partial<GithubPullRequest> = {},
): GithubPullRequest => ({
  number: 1,
  title: 't',
  repo: 'a/b',
  url: 'u',
  draft: false,
  updatedAt: '2026-05-15T00:00:00Z',
  requestedReviewers: [],
  isApproved: false,
  ...overrides,
});

const buildCollector = (
  githubTasks: AssignedTasks,
): DailyPlanContextCollector =>
  new DailyPlanContextCollector(
    {
      findLatestSucceededRun: jest.fn().mockResolvedValue(null),
      findRecentSucceededRuns: jest.fn().mockResolvedValue([]),
      findSimilarPlans: jest.fn().mockResolvedValue([]),
    } as unknown as AgentRunService,
    {
      execute: jest.fn().mockResolvedValue(githubTasks),
    } as unknown as ListAssignedTasksUsecase,
    {
      execute: jest.fn().mockResolvedValue([]),
    } as unknown as ListMyMentionsUsecase,
    {
      execute: jest.fn().mockResolvedValue([]),
    } as unknown as ListActiveTasksUsecase,
    {
      peekPending: jest.fn().mockResolvedValue([]),
      markConsumed: jest.fn().mockResolvedValue(undefined),
    } as unknown as SlackInboxService,
  );

describe('DailyPlanContextCollector — excludeApprovedPullRequests', () => {
  const githubTasks: AssignedTasks = {
    issues: [],
    pullRequests: [
      buildPr({ number: 1, title: 'open PR', isApproved: false }),
      buildPr({ number: 2, title: 'approved PR', isApproved: true }),
    ],
  };

  it('default (excludeApprovedPullRequests=false) 에서는 isApproved=true 인 PR 도 포함', async () => {
    const collector = buildCollector(githubTasks);
    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
    });

    expect(context.githubTasks?.pullRequests).toHaveLength(2);
    expect(context.githubTasks?.pullRequests.some((pr) => pr.isApproved)).toBe(
      true,
    );
  });

  it('excludeApprovedPullRequests=true 일 때 isApproved=true 인 PR 은 제외 (Morning Briefing 동작)', async () => {
    const collector = buildCollector(githubTasks);
    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
      excludeApprovedPullRequests: true,
    });

    expect(context.githubTasks?.pullRequests).toHaveLength(1);
    expect(context.githubTasks?.pullRequests[0].number).toBe(1);
    expect(context.githubTasks?.issues).toHaveLength(0);
  });

  it('githubTasks null (fetch 실패) 일 때는 excludeApprovedPullRequests 무관하게 그대로 null 전달', async () => {
    const collector = new DailyPlanContextCollector(
      {
        findLatestSucceededRun: jest.fn().mockResolvedValue(null),
        findRecentSucceededRuns: jest.fn().mockResolvedValue([]),
        findSimilarPlans: jest.fn().mockResolvedValue([]),
      } as unknown as AgentRunService,
      {
        execute: jest.fn().mockRejectedValue(new Error('GITHUB_TOKEN missing')),
      } as unknown as ListAssignedTasksUsecase,
      {
        execute: jest.fn().mockResolvedValue([]),
      } as unknown as ListMyMentionsUsecase,
      {
        execute: jest.fn().mockResolvedValue([]),
      } as unknown as ListActiveTasksUsecase,
      {
        peekPending: jest.fn().mockResolvedValue([]),
        markConsumed: jest.fn().mockResolvedValue(undefined),
      } as unknown as SlackInboxService,
    );

    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
      excludeApprovedPullRequests: true,
    });

    expect(context.githubTasks).toBeNull();
  });
});
