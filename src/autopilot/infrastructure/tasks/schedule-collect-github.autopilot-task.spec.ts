import { ConfigService } from '@nestjs/config';

import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { CloseFinishedIssuesUsecase } from '../../../schedule/application/close-finished-issues.usecase';
import { ReconcilePullRequestsUsecase } from '../../../schedule/application/reconcile-pull-requests.usecase';
import { ScheduleRepositoryPort } from '../../../schedule/domain/port/schedule.repository.port';
import { ScheduleCollectionStateRepositoryPort } from '../../../schedule/domain/port/schedule-collection-state.repository.port';
import {
  RecordEventAndTransitionInput,
  ScheduleActor,
  TransitionInput,
} from '../../../schedule/domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import { ScheduleCollectGithubAutopilotTask } from './schedule-collect-github.autopilot-task';

const issue = {
  repo: 'Acme/API',
  number: 12,
  url: 'https://github.com/Acme/API/issues/12',
  title: '결제 오류',
};
const pullRequest = {
  repo: 'Acme/API',
  number: 4,
  url: 'https://github.com/Acme/API/pull/4',
  title: '결제 API',
  body: '',
  state: 'open',
  mergedAt: null,
  updatedAt: '2026-11-04T00:00:00Z',
  createdAt: '2026-11-03T00:00:00Z',
};
const taskItem = {
  id: 5,
  slackUserId: 'U1',
  status: ScheduleStatus.OPEN,
  source: ScheduleSource.GITHUB_ISSUE,
  sourceKey: issue.url,
  title: '[API] 결제 오류',
  dueDate: null,
};

describe('ScheduleCollectGithubAutopilotTask', () => {
  const repository = {
    createCollected: jest.fn(),
    findBySourceKey: jest.fn(),
    findBySource: jest.fn(),
    findAllByOwner: jest.fn(),
    findById: jest.fn(),
    findDetail: jest.fn(),
    addEvent: jest.fn(),
    recordEventAndTransition: jest.fn(),
    transition: jest.fn(),
  };
  const stateRepository = { get: jest.fn(), markSucceeded: jest.fn() };
  const assigned = { execute: jest.fn() };
  const github = {
    listAuthorOpenPullRequests: jest.fn(),
    listAuthorMergedPullRequestsSince: jest.fn(),
    getItemLifecycle: jest.fn(),
  };
  const config = { get: jest.fn() };
  const closeFinishedIssues = { execute: jest.fn() };
  const makeTask = () =>
    new ScheduleCollectGithubAutopilotTask(
      repository as unknown as ScheduleRepositoryPort,
      stateRepository as unknown as ScheduleCollectionStateRepositoryPort,
      assigned as unknown as ListAssignedTasksUsecase,
      new ReconcilePullRequestsUsecase(
        repository as unknown as ScheduleRepositoryPort,
        stateRepository as unknown as ScheduleCollectionStateRepositoryPort,
        github as unknown as GithubClientPort,
        config as unknown as ConfigService,
      ),
      config as unknown as ConfigService,
      closeFinishedIssues as unknown as CloseFinishedIssuesUsecase,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    closeFinishedIssues.execute.mockResolvedValue(undefined);
    config.get.mockImplementation((key: string) =>
      key === 'CONSOLE_OWNER_SLACK_USER_ID' ? 'U1' : 'JSL107',
    );
    stateRepository.get.mockResolvedValue(null);
    assigned.execute.mockResolvedValue({ issues: [issue], pullRequests: [] });
    github.listAuthorOpenPullRequests.mockResolvedValue([]);
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([]);
    repository.findBySourceKey.mockResolvedValue(null);
    repository.findBySource.mockResolvedValue([]);
    repository.findAllByOwner.mockResolvedValue([]);
    repository.findById.mockResolvedValue(taskItem);
    repository.createCollected.mockResolvedValue(taskItem);
    repository.addEvent.mockResolvedValue({ id: 1 });
    repository.recordEventAndTransition.mockResolvedValue({
      item: taskItem,
      transitioned: true,
    });
    repository.transition.mockResolvedValue(taskItem);
  });

  it('배정 이슈만 이번 달 하한과 100건 한도로 조회해 레포 접두 제목으로 저장한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T08:00:00Z'));
    stateRepository.get.mockResolvedValue(new Date('2026-11-04T07:00:00Z'));
    await makeTask().run();
    expect(assigned.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 100,
        updatedSinceIsoDate: '2026-11-01',
      }),
    );
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ScheduleSource.GITHUB_ISSUE,
        sourceKey: issue.url,
        title: '[API] 결제 오류',
      }),
    );
    expect(stateRepository.markSucceeded).toHaveBeenCalledWith(
      ScheduleSource.GITHUB_ISSUE,
      expect.any(Date),
    );
    jest.useRealTimers();
  });

  it('짝 없는 열린 PR을 IN_PROGRESS 업무로 저장하며 생성 시각을 startedAt에 쓴다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    github.listAuthorOpenPullRequests.mockResolvedValue([pullRequest]);
    await makeTask().run();
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ScheduleSource.GITHUB_PR,
        sourceKey: pullRequest.url,
        status: ScheduleStatus.IN_PROGRESS,
        dueDate: null,
        startedAt: new Date(pullRequest.createdAt),
      }),
    );
  });

  it('짝 하나는 이벤트가 처음 기록된 경우에만 상태를 올리고 DUPLICATE 후에는 전이하지 않는다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    repository.findAllByOwner.mockResolvedValue([taskItem]);
    github.listAuthorOpenPullRequests.mockResolvedValue([
      { ...pullRequest, body: 'closes #12' },
    ]);
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: ScheduleEventKind.PR_LINKED,
          dedupeKey: pullRequest.url,
        }),
        transitionFrom: [ScheduleStatus.OPEN, ScheduleStatus.CANDIDATE],
        transitionTo: ScheduleStatus.IN_PROGRESS,
        actor: ScheduleActor.COLLECTOR,
      }),
    );
    repository.recordEventAndTransition.mockClear();
    repository.recordEventAndTransition.mockResolvedValue('DUPLICATE');
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledTimes(1);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('머지 전이 실패 후 다음 회차가 사건을 재시도하고 DUPLICATE면 전이하지 않는다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    const inProgressItem = {
      ...taskItem,
      status: ScheduleStatus.IN_PROGRESS,
    };
    repository.findAllByOwner.mockResolvedValue([inProgressItem]);
    repository.findById.mockResolvedValue(inProgressItem);
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([
      { ...pullRequest, state: 'merged', body: 'closes #12' },
    ]);
    const error = new Error('transient transition failure');
    const stored = {
      status: ScheduleStatus.IN_PROGRESS,
      committedEventCount: 0,
      failNextTransition: true,
    };
    repository.addEvent.mockImplementation(async () => {
      if (stored.committedEventCount > 0) {
        return 'DUPLICATE';
      }
      stored.committedEventCount += 1;
      return { id: 1 };
    });
    repository.transition.mockImplementation(async (input: TransitionInput) => {
      if (stored.failNextTransition) {
        stored.failNextTransition = false;
        throw error;
      }
      stored.status = input.to;
      return { ...inProgressItem, status: input.to };
    });
    repository.recordEventAndTransition.mockImplementation(
      async (input: RecordEventAndTransitionInput) => {
        if (stored.committedEventCount > 0) {
          return 'DUPLICATE';
        }
        if (stored.failNextTransition) {
          stored.failNextTransition = false;
          throw error;
        }
        stored.committedEventCount += 1;
        stored.status = input.transitionTo ?? stored.status;
        return {
          item: { ...inProgressItem, status: stored.status },
          transitioned: true,
        };
      },
    );

    await makeTask().run();
    expect(stateRepository.markSucceeded).not.toHaveBeenCalledWith(
      ScheduleSource.GITHUB_PR,
      expect.any(Date),
    );
    await makeTask().run();
    await makeTask().run();

    expect(stored.status).toBe(ScheduleStatus.DONE);
    expect(stored.committedEventCount).toBe(1);
  });

  it('같은 회차의 PR_LINKED 다음 PR_MERGED는 최신 IN_PROGRESS에서 DONE으로 전이한다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    repository.findAllByOwner.mockResolvedValue([taskItem]);
    github.listAuthorOpenPullRequests.mockResolvedValue([
      { ...pullRequest, body: 'closes #12' },
    ]);
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([
      {
        ...pullRequest,
        number: 8,
        url: 'https://github.com/Acme/API/pull/8',
        body: 'closes #12',
        state: 'merged',
        mergedAt: '2026-11-04T05:00:00Z',
      },
    ]);
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        transitionTo: ScheduleStatus.IN_PROGRESS,
      }),
    );
    expect(repository.recordEventAndTransition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        transitionTo: ScheduleStatus.DONE,
      }),
    );
  });

  it('머지 PR을 처음 발견하면 업무를 만든 뒤 DONE으로 전이하고 PR_MERGED 사건을 기록한다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([
      { ...pullRequest, state: 'merged', mergedAt: '2026-11-04T05:00:00Z' },
    ]);
    repository.findById.mockResolvedValue({
      ...taskItem,
      status: ScheduleStatus.IN_PROGRESS,
    });
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: ScheduleEventKind.PR_MERGED }),
        transitionTo: ScheduleStatus.DONE,
      }),
    );
  });

  it('머지 PR의 완료 시각은 수집 시각이 아닌 머지 시각이다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([
      { ...pullRequest, state: 'merged', mergedAt: '2026-11-04T05:00:00Z' },
    ]);
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        completedAt: new Date('2026-11-04T05:00:00Z'),
      }),
    );
  });

  it('열린 목록에서 사라진 PR은 lifecycle 직접 확인 뒤에만 SKIPPED로 닫는다', async () => {
    repository.findBySource.mockResolvedValue([
      {
        ...taskItem,
        source: ScheduleSource.GITHUB_PR,
        sourceKey: pullRequest.url,
        status: ScheduleStatus.IN_PROGRESS,
      },
    ]);
    github.getItemLifecycle.mockResolvedValue({
      state: 'closed',
      mergedAt: null,
      isPullRequest: true,
    });
    await makeTask().run();
    expect(github.getItemLifecycle).toHaveBeenCalledWith({
      repo: 'Acme/API',
      number: 4,
    });
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({ transitionTo: ScheduleStatus.SKIPPED }),
    );
  });

  it('lifecycle에서 확인한 머지 시각도 완료 시각으로 기록한다', async () => {
    repository.findBySource.mockResolvedValue([
      {
        ...taskItem,
        source: ScheduleSource.GITHUB_PR,
        sourceKey: pullRequest.url,
        status: ScheduleStatus.IN_PROGRESS,
      },
    ]);
    github.getItemLifecycle.mockResolvedValue({
      state: 'closed',
      mergedAt: '2026-11-04T05:00:00Z',
      isPullRequest: true,
    });
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        completedAt: new Date('2026-11-04T05:00:00Z'),
      }),
    );
  });

  it('사용자가 SKIPPED한 PR은 열린 목록에 다시 나타나도 되살리지 않는다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    github.listAuthorOpenPullRequests.mockResolvedValue([pullRequest]);
    repository.findBySource.mockResolvedValue([
      {
        ...taskItem,
        source: ScheduleSource.GITHUB_PR,
        sourceKey: pullRequest.url,
        status: ScheduleStatus.SKIPPED,
      },
    ]);
    repository.findBySourceKey.mockResolvedValue({
      ...taskItem,
      source: ScheduleSource.GITHUB_PR,
      status: ScheduleStatus.SKIPPED,
    });
    repository.findDetail.mockResolvedValue({
      events: [
        {
          kind: ScheduleEventKind.STATUS_CHANGED,
          payload: { actor: ScheduleActor.USER, to: ScheduleStatus.SKIPPED },
        },
      ],
    });
    await makeTask().run();
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('PR 조회가 실패하면 업무 상태와 PR 커서를 바꾸지 않는다', async () => {
    github.listAuthorOpenPullRequests.mockRejectedValue(new Error('network'));
    await makeTask().run();
    expect(repository.transition).not.toHaveBeenCalled();
    expect(stateRepository.markSucceeded).not.toHaveBeenCalledWith(
      ScheduleSource.GITHUB_PR,
      expect.any(Date),
    );
    expect(repository.createCollected).not.toHaveBeenCalled();
  });

  it('이미 완료한 이슈 업무에도 PR을 연결하고 새 PR 업무는 만들지 않는다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    repository.findAllByOwner.mockResolvedValue([
      { ...taskItem, status: ScheduleStatus.DONE },
    ]);
    repository.findById.mockResolvedValue({
      ...taskItem,
      status: ScheduleStatus.DONE,
    });
    github.listAuthorOpenPullRequests.mockResolvedValue([
      { ...pullRequest, body: 'closes #12' },
    ]);
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          scheduleItemId: taskItem.id,
          kind: ScheduleEventKind.PR_LINKED,
        }),
      }),
    );
    expect(repository.createCollected).not.toHaveBeenCalled();
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('같은 회차에 새로 모은 이슈에 PR을 연결한다', async () => {
    let issueCreated = false;
    repository.createCollected.mockImplementation(
      async (input: { source: ScheduleSource }) => {
        if (input.source === ScheduleSource.GITHUB_ISSUE) {
          issueCreated = true;
        }
        return taskItem;
      },
    );
    repository.findAllByOwner.mockImplementation(async () =>
      issueCreated ? [taskItem] : [],
    );
    github.listAuthorOpenPullRequests.mockResolvedValue([
      { ...pullRequest, body: 'closes #12' },
    ]);

    await makeTask().run();

    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          scheduleItemId: taskItem.id,
          kind: ScheduleEventKind.PR_LINKED,
        }),
      }),
    );
    expect(repository.createCollected).toHaveBeenCalledTimes(1);
  });

  it('이슈 참조가 둘 이상 업무에 맞으면 어느 쪽에도 연결하거나 생성하지 않는다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    repository.findAllByOwner.mockResolvedValue([
      taskItem,
      { ...taskItem, id: 6 },
    ]);
    github.listAuthorOpenPullRequests.mockResolvedValue([
      { ...pullRequest, body: 'closes #12' },
    ]);
    await makeTask().run();
    expect(repository.addEvent).not.toHaveBeenCalled();
    expect(repository.createCollected).not.toHaveBeenCalled();
  });

  it('수집기가 SKIPPED한 PR만 다시 열리면 IN_PROGRESS로 전이한다', async () => {
    assigned.execute.mockResolvedValue({ issues: [], pullRequests: [] });
    github.listAuthorOpenPullRequests.mockResolvedValue([pullRequest]);
    repository.findBySourceKey.mockResolvedValue({
      ...taskItem,
      source: ScheduleSource.GITHUB_PR,
      status: ScheduleStatus.SKIPPED,
    });
    repository.findDetail.mockResolvedValue({
      events: [
        {
          kind: ScheduleEventKind.STATUS_CHANGED,
          payload: {
            actor: ScheduleActor.COLLECTOR,
            to: ScheduleStatus.SKIPPED,
          },
        },
      ],
    });
    await makeTask().run();
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        transitionFrom: [ScheduleStatus.SKIPPED],
        transitionTo: ScheduleStatus.IN_PROGRESS,
      }),
    );
  });

  // 레포가 지워지거나 권한이 사라진 PR 하나가 매 회차 404 를 내도 수집 전체가 멈추면 안 된다.
  // 조회 실패를 닫힘으로 보지 않는 원칙은 그 PR 만 건너뛰는 것으로 지킨다 — 다음 회차가 다시 확인한다.
  it('lifecycle 조회가 실패한 PR 만 건너뛰고 나머지 수집과 커서 전진은 계속한다', async () => {
    repository.findBySource.mockResolvedValue([
      {
        ...taskItem,
        source: ScheduleSource.GITHUB_PR,
        sourceKey: pullRequest.url,
        status: ScheduleStatus.IN_PROGRESS,
      },
    ]);
    github.getItemLifecycle.mockRejectedValue(new Error('not found'));
    await makeTask().run();
    expect(repository.createCollected).toHaveBeenCalled();
    expect(repository.transition).not.toHaveBeenCalled();
    expect(stateRepository.markSucceeded).toHaveBeenCalledWith(
      ScheduleSource.GITHUB_PR,
      expect.any(Date),
    );
  });
});
