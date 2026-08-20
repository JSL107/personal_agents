import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FailedRunDetail } from '../../../agent-run/domain/port/agent-run.repository.port';
import { ClassifyPullRequestEngagementUsecase } from '../../../github/application/classify-pr-engagement.usecase';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import {
  AssignedTasks,
  GithubPullRequest,
  GithubPullRequestSummary,
} from '../../../github/domain/github.type';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { WaitingItem } from '../../../github/domain/pr-engagement.type';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { NotionTask } from '../../../notion/domain/notion.type';
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import { SlackMention } from '../../../slack-collector/domain/slack-collector.type';
import { PoShadowContextCollector } from './po-shadow-context.collector';

const activePullRequest: GithubPullRequest = {
  number: 42,
  title: '근거 수집기 배선',
  repo: 'idaeri/app',
  url: 'https://github.com/idaeri/app/pull/42',
  draft: false,
  updatedAt: '2026-08-19T00:30:00.000Z',
  requestedReviewers: ['reviewer'],
  isApproved: false,
};

const waitingPullRequest: GithubPullRequest = {
  number: 43,
  title: '리뷰 대기 PR',
  repo: 'idaeri/app',
  url: 'https://github.com/idaeri/app/pull/43',
  draft: false,
  updatedAt: '2026-08-18T00:30:00.000Z',
  requestedReviewers: [],
  isApproved: true,
};

const assignedTasks: AssignedTasks = {
  issues: [
    {
      number: 41,
      title: '정오 대조 구현',
      repo: 'idaeri/app',
      url: 'https://github.com/idaeri/app/issues/41',
      labels: ['feature'],
      updatedAt: '2026-08-19T00:00:00.000Z',
      body: '정오 시점의 실제 상태를 수집한다.',
    },
  ],
  pullRequests: [activePullRequest, waitingPullRequest],
};

const waitingItem: WaitingItem = {
  title: waitingPullRequest.title,
  url: waitingPullRequest.url,
  reason: '승인 완료 후 머지 대기 중',
};

const mention: SlackMention = {
  channelId: 'C123',
  channelName: 'product',
  channelType: 'public_channel',
  authorUserId: 'U456',
  ts: '1787103000.000100',
  text: '<@U123> 배포 일정 확인 부탁드립니다.',
  permalink: 'https://slack.example.com/archives/C123/p1787103000000100',
};

const notionTask: NotionTask = {
  databaseId: 'database-1',
  pageId: 'page-1',
  url: 'https://notion.so/page-1',
  title: '출시 체크리스트',
  properties: { 상태: '진행 중', 우선순위: '높음' },
};

const failedRun: FailedRunDetail = {
  agentType: 'CODE_REVIEWER',
  reason: 'CLI timeout',
  endedAt: new Date('2026-08-19T02:00:00.000Z'),
};

interface CollectorDependencies {
  listAssignedTasks: { execute: jest.Mock };
  classifyEngagement: { execute: jest.Mock };
  listMyMentions: { execute: jest.Mock };
  listActiveTasks: { execute: jest.Mock };
  agentRunService: { findFailedRunsSince: jest.Mock };
  configService: { get: jest.Mock };
  githubClient: { listAuthorMergedPullRequestsSince: jest.Mock };
}

const mergedPullRequest: GithubPullRequestSummary = {
  number: 264,
  title: '업로드 차단',
  body: '',
  repo: 'idaeri/app',
  url: 'https://github.com/idaeri/app/pull/264',
  state: 'merged',
  mergedAt: '2026-08-19T02:10:00.000Z',
  updatedAt: '2026-08-19T02:10:00.000Z',
  additions: 10,
  deletions: 2,
  changedFilesCount: 1,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

// fixture 멘션(ts=1787103000)보다 앞선 시각 — 계획 이후 멘션만 남기는 필터를 통과시킨다.
const PLAN_ENDED_AT = new Date(1787102000 * 1000);

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const createDependencies = (): CollectorDependencies => ({
  listAssignedTasks: {
    execute: jest.fn().mockResolvedValue(assignedTasks),
  },
  classifyEngagement: {
    execute: jest.fn().mockResolvedValue({
      activePullRequests: [activePullRequest],
      waitingItems: [waitingItem],
    }),
  },
  listMyMentions: {
    execute: jest.fn().mockResolvedValue([mention]),
  },
  listActiveTasks: {
    execute: jest.fn().mockResolvedValue([notionTask]),
  },
  agentRunService: {
    findFailedRunsSince: jest.fn().mockResolvedValue([failedRun]),
  },
  configService: {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'IMPACT_REPORT_GITHUB_AUTHOR' ? 'JSL107' : null,
      ),
  },
  githubClient: {
    listAuthorMergedPullRequestsSince: jest
      .fn()
      .mockResolvedValue([mergedPullRequest]),
  },
});

const createCollector = ({
  listAssignedTasks,
  classifyEngagement,
  listMyMentions,
  listActiveTasks,
  agentRunService,
  configService,
  githubClient,
}: CollectorDependencies): PoShadowContextCollector =>
  new PoShadowContextCollector(
    listAssignedTasks as unknown as ListAssignedTasksUsecase,
    classifyEngagement as unknown as ClassifyPullRequestEngagementUsecase,
    listMyMentions as unknown as ListMyMentionsUsecase,
    listActiveTasks as unknown as ListActiveTasksUsecase,
    agentRunService as unknown as AgentRunService,
    configService as unknown as ConfigService,
    githubClient as unknown as GithubClientPort,
  );

describe('PoShadowContextCollector', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('외부 컨텍스트를 수집하고 계획 종료 후 올림 시간으로 Slack 멘션을 조회한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T03:00:00.000Z'));
    const dependencies = createDependencies();
    const collector = createCollector(dependencies);

    const context = await collector.collect({
      slackUserId: 'U123',
      planEndedAt: new Date('2026-08-19T00:29:59.000Z'),
    });

    expect(context).toEqual({
      assignedTasks,
      activePullRequests: [activePullRequest],
      waitingItems: [waitingItem],
      newMentions: [mention],
      notionTasks: [notionTask],
      failedRunsToday: [failedRun],
      mergedPullRequests: [mergedPullRequest],
      mergedLookupAvailable: true,
      degradedSources: [],
    });
    expect(dependencies.listMyMentions.execute).toHaveBeenCalledWith({
      slackUserId: 'U123',
      sinceHours: 3,
    });
    // 계획 수립 시각 이후 머지만 본다 — 어제 머지까지 끌어오면 오늘 계획과 무관한 항목이 섞인다.
    expect(
      dependencies.githubClient.listAuthorMergedPullRequestsSince,
    ).toHaveBeenCalledWith({
      repo: null,
      author: 'JSL107',
      sinceIsoDate: '2026-08-19T00:29:59.000Z',
      limit: 20,
    });
    expect(dependencies.classifyEngagement.execute).toHaveBeenCalledWith(
      assignedTasks.pullRequests,
    );
    expect(
      dependencies.agentRunService.findFailedRunsSince,
    ).toHaveBeenCalledWith({ withinMinutes: 1440, slackUserId: 'U123' });
  });

  it('첫 fetch가 끝나기 전에 독립적인 다섯 fetch를 모두 시작한다', async () => {
    const assignedTasksDeferred = createDeferred<AssignedTasks>();
    const mentionsDeferred = createDeferred<SlackMention[]>();
    const notionTasksDeferred = createDeferred<NotionTask[]>();
    const failedRunsDeferred = createDeferred<FailedRunDetail[]>();
    const mergedDeferred = createDeferred<GithubPullRequestSummary[]>();
    const dependencies = createDependencies();
    dependencies.githubClient.listAuthorMergedPullRequestsSince.mockReturnValue(
      mergedDeferred.promise,
    );
    dependencies.listAssignedTasks.execute.mockReturnValue(
      assignedTasksDeferred.promise,
    );
    dependencies.listMyMentions.execute.mockReturnValue(
      mentionsDeferred.promise,
    );
    dependencies.listActiveTasks.execute.mockReturnValue(
      notionTasksDeferred.promise,
    );
    dependencies.agentRunService.findFailedRunsSince.mockReturnValue(
      failedRunsDeferred.promise,
    );
    const collector = createCollector(dependencies);

    const collection = collector.collect({
      slackUserId: 'U123',
      planEndedAt: PLAN_ENDED_AT,
    });

    expect(dependencies.listAssignedTasks.execute).toHaveBeenCalledTimes(1);
    expect(dependencies.listMyMentions.execute).toHaveBeenCalledTimes(1);
    expect(dependencies.listActiveTasks.execute).toHaveBeenCalledTimes(1);
    expect(
      dependencies.agentRunService.findFailedRunsSince,
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.githubClient.listAuthorMergedPullRequestsSince,
    ).toHaveBeenCalledTimes(1);

    assignedTasksDeferred.resolve(assignedTasks);
    mentionsDeferred.resolve([mention]);
    notionTasksDeferred.resolve([notionTask]);
    failedRunsDeferred.resolve([failedRun]);
    mergedDeferred.resolve([mergedPullRequest]);

    await expect(collection).resolves.toEqual({
      assignedTasks,
      activePullRequests: [activePullRequest],
      waitingItems: [waitingItem],
      newMentions: [mention],
      notionTasks: [notionTask],
      failedRunsToday: [failedRun],
      mergedPullRequests: [mergedPullRequest],
      mergedLookupAvailable: true,
      degradedSources: [],
    });
  });

  it.each([
    ['하한', '2026-08-19T02:59:59.999Z', 1],
    ['상한', '2026-08-18T12:00:00.000Z', 12],
  ])('sinceHours %s을 적용한다', async (_label, planEndedAt, sinceHours) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T03:00:00.000Z'));
    const dependencies = createDependencies();
    const collector = createCollector(dependencies);

    await collector.collect({
      slackUserId: 'U123',
      planEndedAt: new Date(planEndedAt),
    });

    expect(dependencies.listMyMentions.execute).toHaveBeenCalledWith({
      slackUserId: 'U123',
      sinceHours,
    });
  });

  it('assigned tasks 실패 시 GitHub 컨텍스트만 비운다', async () => {
    const dependencies = createDependencies();
    dependencies.listAssignedTasks.execute.mockRejectedValue(
      new Error('GitHub unavailable'),
    );
    const collector = createCollector(dependencies);

    const context = await collector.collect({
      slackUserId: 'U123',
      planEndedAt: PLAN_ENDED_AT,
    });

    expect(context.assignedTasks).toBeNull();
    expect(context.activePullRequests).toEqual([]);
    expect(context.waitingItems).toEqual([]);
    expect(context.newMentions).toEqual([mention]);
    expect(dependencies.classifyEngagement.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['Slack 멘션', 'listMyMentions', 'newMentions'],
    ['Notion task', 'listActiveTasks', 'notionTasks'],
    ['실패 run', 'agentRunService', 'failedRunsToday'],
  ] as const)(
    '%s 실패 시 해당 배열만 비운다',
    async (_label, dependencyName, resultName) => {
      const dependencies = createDependencies();
      const dependency = dependencies[dependencyName];
      const method =
        'execute' in dependency
          ? dependency.execute
          : dependency.findFailedRunsSince;
      method.mockRejectedValue(new Error(`${dependencyName} unavailable`));
      const collector = createCollector(dependencies);

      const context = await collector.collect({
        slackUserId: 'U123',
        planEndedAt: PLAN_ENDED_AT,
      });

      expect(context[resultName]).toEqual([]);
      expect(context.assignedTasks).toEqual(assignedTasks);
      expect(context.activePullRequests).toEqual([activePullRequest]);
    },
  );

  it('classifier 실패 시 assigned tasks와 원본 PR을 보존한다', async () => {
    const dependencies = createDependencies();
    dependencies.classifyEngagement.execute.mockRejectedValue(
      new Error('classifier unavailable'),
    );
    const collector = createCollector(dependencies);

    const context = await collector.collect({
      slackUserId: 'U123',
      planEndedAt: PLAN_ENDED_AT,
    });

    expect(context.assignedTasks).toEqual(assignedTasks);
    expect(context.activePullRequests).toEqual(assignedTasks.pullRequests);
    expect(context.waitingItems).toEqual([]);
  });

  // 전부 실패한 회차가 빈 컨텍스트만 남기면 사실이 0건이 되고, 카드는 "계획대로 진행 중" 으로
  // 나간다 — 조회가 죽은 날과 진짜 평온한 날의 글자가 같아진다. degradedSources 가 그 둘을 가른다.
  it('모든 의존성이 실패하면 빈 컨텍스트와 함께 실패한 소스를 남긴다', async () => {
    const dependencies = createDependencies();
    dependencies.listAssignedTasks.execute.mockRejectedValue(
      new Error('GitHub unavailable'),
    );
    dependencies.classifyEngagement.execute.mockRejectedValue(
      new Error('classifier unavailable'),
    );
    dependencies.listMyMentions.execute.mockRejectedValue(
      new Error('Slack unavailable'),
    );
    dependencies.listActiveTasks.execute.mockRejectedValue(
      new Error('Notion unavailable'),
    );
    dependencies.agentRunService.findFailedRunsSince.mockRejectedValue(
      new Error('AgentRun unavailable'),
    );
    dependencies.githubClient.listAuthorMergedPullRequestsSince.mockRejectedValue(
      new Error('GitHub search unavailable'),
    );
    const collector = createCollector(dependencies);

    const context = await collector.collect({
      slackUserId: 'U123',
      planEndedAt: PLAN_ENDED_AT,
    });

    expect(context).toEqual({
      assignedTasks: null,
      activePullRequests: [],
      waitingItems: [],
      newMentions: [],
      notionTasks: [],
      failedRunsToday: [],
      mergedPullRequests: [],
      mergedLookupAvailable: false,
      degradedSources: [
        'GitHub 담당 목록',
        'GitHub 머지 목록',
        'Slack 멘션',
        'Notion 태스크',
        '실행 원장',
      ],
    });
  });

  // 분류 실패는 원본 PR 이 남아도 "방치" 판정이 통째로 사라진다. 조회 실패로 남기지 않으면
  // 대기 중인 PR 이 있는데도 조용한 회차로 나간다.
  it('PR 진행 신호 분류가 실패하면 조회 실패로 남긴다', async () => {
    const dependencies = createDependencies();
    dependencies.classifyEngagement.execute.mockRejectedValue(
      new Error('engagement unavailable'),
    );
    const collector = createCollector(dependencies);

    const context = await collector.collect({
      slackUserId: 'U123',
      planEndedAt: PLAN_ENDED_AT,
    });

    expect(context.degradedSources).toContain('GitHub PR 진행 신호');
  });

  // 조회 창은 시간 단위 올림이라 계획보다 앞선다. 재필터가 없으면 아침 계획 전에 온 멘션이
  // "계획 이후 새 멘션" 으로 카드에 오른다.
  it('계획 종료 이전 멘션은 새 멘션에서 제외한다', async () => {
    const dependencies = createDependencies();
    const collector = createCollector(dependencies);

    const context = await collector.collect({
      slackUserId: 'U123',
      planEndedAt: new Date(1787103000 * 1000 + 1000),
    });

    expect(context.newMentions).toEqual([]);
  });

  it('머지 조회 author env 가 없으면 조회를 건너뛰되 실패로 세지 않는다', async () => {
    const dependencies = createDependencies();
    dependencies.configService.get.mockReturnValue(undefined);
    const collector = createCollector(dependencies);

    const context = await collector.collect({
      slackUserId: 'U123',
      planEndedAt: PLAN_ENDED_AT,
    });

    expect(
      dependencies.githubClient.listAuthorMergedPullRequestsSince,
    ).not.toHaveBeenCalled();
    expect(context.mergedPullRequests).toEqual([]);
    // 설정이 없는 것과 조회가 죽은 것은 다르다 — 실패로는 세지 않되, 확인하지 못했다는
    // 사실은 남겨 미발견 판정이 서지 않게 한다.
    expect(context.mergedLookupAvailable).toBe(false);
    expect(context.degradedSources).toEqual([]);
  });
});
