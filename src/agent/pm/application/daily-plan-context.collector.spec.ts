import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ClassifyPullRequestEngagementUsecase } from '../../../github/application/classify-pr-engagement.usecase';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import {
  AssignedTasks,
  GithubPullRequest,
} from '../../../github/domain/github.type';
import { WaitingItem } from '../../../github/domain/pr-engagement.type';
import { WorkSessionDigestService } from '../../../local-sessions/application/work-session-digest.service';
import { WorkSessionDigest } from '../../../local-sessions/domain/work-session-digest';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import { SlackMention } from '../../../slack-collector/domain/slack-collector.type';
import { SlackInboxService } from '../../../slack-inbox/application/slack-inbox.service';
import { SlackInboxItem } from '../../../slack-inbox/domain/slack-inbox.type';
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

const buildClassifyMock = (split: {
  activePullRequests: GithubPullRequest[];
  waitingItems: WaitingItem[];
}): ClassifyPullRequestEngagementUsecase =>
  ({
    execute: jest.fn().mockResolvedValue(split),
  }) as unknown as ClassifyPullRequestEngagementUsecase;

const buildWorkSessionMock = (): WorkSessionDigestService =>
  ({
    listSince: jest.fn().mockReturnValue([]),
  }) as unknown as WorkSessionDigestService;

const buildCollector = (
  githubTasks: AssignedTasks,
  classifyEngagement?: ClassifyPullRequestEngagementUsecase,
  workSessionDigestService = buildWorkSessionMock(),
): DailyPlanContextCollector =>
  new DailyPlanContextCollector(
    {
      findLatestSucceededRun: jest.fn().mockResolvedValue(null),
      findRecentSucceededRuns: jest.fn().mockResolvedValue([]),
      findRecentFailedRuns: jest.fn().mockResolvedValue([]),
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
    classifyEngagement ??
      buildClassifyMock({ activePullRequests: [], waitingItems: [] }),
    workSessionDigestService,
  );

describe('DailyPlanContextCollector — excludeApprovedPullRequests', () => {
  const githubTasks: AssignedTasks = {
    issues: [],
    pullRequests: [
      buildPr({ number: 1, title: 'open PR', isApproved: false }),
      buildPr({ number: 2, title: 'approved PR', isApproved: true }),
    ],
  };

  it('직전 평일 09:00 KST 이후 세션을 수집한다', async () => {
    const session: WorkSessionDigest = {
      source: 'codex',
      sessionId: 'session-1',
      repo: 'personal_agents',
      branch: null,
      title: null,
      pullRequests: [],
      firstPrompt: '테스트 작성',
      lastPrompt: null,
      lastReply: null,
      lastActivityAt: new Date(),
    };
    const listSince = jest.fn().mockReturnValue([session]);
    const collector = buildCollector(githubTasks, undefined, {
      listSince,
    } as unknown as WorkSessionDigestService);

    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
    });

    expect(context.workSessions).toEqual([session]);
    expect(listSince).toHaveBeenCalledWith({
      since: context.workSessionsSince,
      slackUserId: expect.any(String),
    });
    expect(context.workSessionsSince.getUTCHours()).toBe(0);
  });

  it('세션 조회 실패 시 빈 배열로 계속한다', async () => {
    const collector = buildCollector(githubTasks, undefined, {
      listSince: jest.fn(() => {
        throw new Error('unavailable');
      }),
    } as unknown as WorkSessionDigestService);

    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
    });

    expect(context.workSessions).toEqual([]);
  });

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

  it('Slack mention 과 Inbox 가 동일 (channel, ts) 면 mention 쪽 제거 — B3 D3 dedup', async () => {
    const sharedChannel = 'C1';
    const sharedTs = '1730000000.000100';
    const mentions: SlackMention[] = [
      {
        channelId: sharedChannel,
        channelName: 'general',
        channelType: 'public_channel',
        authorUserId: 'U_AUTHOR',
        ts: sharedTs,
        text: '같은 메시지 — mention 도 inbox 도 잡음',
        permalink: undefined,
      },
      {
        channelId: 'C2',
        channelName: 'dev',
        channelType: 'public_channel',
        authorUserId: 'U_AUTHOR',
        ts: '1730000050.000200',
        text: 'inbox 와 겹치지 않는 mention — 살아남아야 함',
        permalink: undefined,
      },
    ];
    const inbox: SlackInboxItem[] = [
      {
        id: 1,
        slackUserId: 'U1',
        channelId: sharedChannel,
        messageTs: sharedTs,
        text: '같은 메시지 — mention 도 inbox 도 잡음',
        addedAt: new Date('2026-05-15T00:00:00Z'),
        consumed: false,
      },
    ];

    const collector = new DailyPlanContextCollector(
      {
        findLatestSucceededRun: jest.fn().mockResolvedValue(null),
        findRecentSucceededRuns: jest.fn().mockResolvedValue([]),
        findSimilarPlans: jest.fn().mockResolvedValue([]),
      } as unknown as AgentRunService,
      {
        execute: jest.fn().mockResolvedValue(githubTasks),
      } as unknown as ListAssignedTasksUsecase,
      {
        execute: jest.fn().mockResolvedValue(mentions),
      } as unknown as ListMyMentionsUsecase,
      {
        execute: jest.fn().mockResolvedValue([]),
      } as unknown as ListActiveTasksUsecase,
      {
        peekPending: jest.fn().mockResolvedValue(inbox),
        markConsumed: jest.fn().mockResolvedValue(undefined),
      } as unknown as SlackInboxService,
      buildClassifyMock({ activePullRequests: [], waitingItems: [] }),
      buildWorkSessionMock(),
    );

    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
    });

    // Inbox 와 겹친 mention 은 제거되고, 겹치지 않는 mention 만 살아남는다.
    expect(context.slackMentions).toHaveLength(1);
    expect(context.slackMentions[0].channelId).toBe('C2');
    // Inbox 는 그대로 보존 — 명시 신호이므로 우선.
    expect(context.inboxItems).toHaveLength(1);
    expect(context.inboxItemIds).toEqual([1]);
  });

  it('classifyWaitingPullRequests=true → WAITING PR 은 waitingItems 로 분리되고 githubTasks 에서 빠짐', async () => {
    const activePr = buildPr({ number: 2, title: 'Active PR' });
    const waitingItem: WaitingItem = {
      title: 'PR1',
      url: 'u1',
      reason: '내가 리뷰 완료 후 대기 중',
    };
    const classifyMock = buildClassifyMock({
      activePullRequests: [activePr],
      waitingItems: [waitingItem],
    });

    const tasksWithTwoPrs: AssignedTasks = {
      issues: [],
      pullRequests: [buildPr({ number: 1, title: 'PR1', url: 'u1' }), activePr],
    };
    const collector = buildCollector(tasksWithTwoPrs, classifyMock);

    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
      classifyWaitingPullRequests: true,
    });

    expect(context.githubTasks?.pullRequests).toHaveLength(1);
    expect(context.githubTasks?.pullRequests[0].number).toBe(2);
    expect(context.waitingItems).toHaveLength(1);
    expect(context.waitingItems[0].title).toBe('PR1');
    expect(classifyMock.execute).toHaveBeenCalledWith(
      tasksWithTwoPrs.pullRequests,
    );
  });

  it('classifyWaitingPullRequests=false → 기존 동작(분류 미실행), waitingItems 빈 배열', async () => {
    const classifyMock = buildClassifyMock({
      activePullRequests: [],
      waitingItems: [],
    });
    const collector = buildCollector(githubTasks, classifyMock);

    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
      classifyWaitingPullRequests: false,
    });

    expect(classifyMock.execute).not.toHaveBeenCalled();
    expect(context.waitingItems).toEqual([]);
    // 기존 PR 은 그대로 포함 (approved 도 포함 — excludeApprovedPullRequests=false default)
    expect(context.githubTasks?.pullRequests).toHaveLength(2);
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
      buildClassifyMock({ activePullRequests: [], waitingItems: [] }),
      buildWorkSessionMock(),
    );

    const context = await collector.collect({
      userText: '',
      slackUserId: 'U1',
      excludeApprovedPullRequests: true,
    });

    expect(context.githubTasks).toBeNull();
  });
});
