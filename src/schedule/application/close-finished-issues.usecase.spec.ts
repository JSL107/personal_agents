import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { AUTO_COMPLETE_CHECK_MAX } from '../domain/daily-todo.constant';
import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleActor } from '../domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { buildScheduleItemRecord } from '../domain/schedule-item.fixture';
import { CloseFinishedIssuesUsecase } from './close-finished-issues.usecase';

const now = new Date('2026-11-04T10:00:00.000Z');
const issue = (id: number, status = ScheduleStatus.OPEN) =>
  buildScheduleItemRecord({
    id,
    status,
    source: ScheduleSource.GITHUB_ISSUE,
    sourceKey: `https://github.com/owner/repo/issues/${id}`,
  });

const createUsecase = (items = [issue(1)]) => {
  const repository = {
    findBySource: jest.fn().mockResolvedValue(items),
    recordEventAndTransition: jest
      .fn()
      .mockResolvedValue({ item: issue(1), transitioned: true }),
    transition: jest.fn(),
  } as unknown as jest.Mocked<ScheduleRepositoryPort>;
  const github = {
    getItemLifecycle: jest.fn().mockResolvedValue({
      state: 'closed',
      closedAt: '2026-11-03T09:00:00.000Z',
      stateReason: 'completed',
      mergedAt: null,
      isPullRequest: false,
    }),
  } as unknown as jest.Mocked<GithubClientPort>;
  return {
    usecase: new CloseFinishedIssuesUsecase(repository, github),
    repository,
    github,
  };
};

describe('CloseFinishedIssuesUsecase', () => {
  it('completed 로 닫힌 이슈는 closedAt 으로 DONE 이 된다', async () => {
    const { usecase, repository, github } = createUsecase();
    await usecase.execute({ ownerId: 'U1', now });
    expect(github.getItemLifecycle).toHaveBeenCalledWith({
      repo: 'owner/repo',
      number: 1,
    });
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith({
      event: {
        scheduleItemId: 1,
        kind: ScheduleEventKind.NOTE,
        payload: expect.any(Object),
        dedupeKey: 'issue-closed:https://github.com/owner/repo/issues/1',
        occurredAt: now,
      },
      slackUserId: 'U1',
      transitionFrom: [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS],
      transitionTo: ScheduleStatus.DONE,
      completedAt: new Date('2026-11-03T09:00:00.000Z'),
      now,
      actor: ScheduleActor.COLLECTOR,
    });
  });

  it.each(['not_planned', 'duplicate'] as const)(
    '%s 로 닫힌 이슈는 SKIPPED 된다',
    async (stateReason) => {
      const { usecase, repository, github } = createUsecase();
      github.getItemLifecycle.mockResolvedValue({
        state: 'closed',
        closedAt: now.toISOString(),
        stateReason,
        mergedAt: null,
        isPullRequest: false,
      });
      await usecase.execute({ ownerId: 'U1', now });
      expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
        expect.objectContaining({ transitionTo: ScheduleStatus.SKIPPED }),
      );
    },
  );

  it('stateReason null 로 닫힌 이슈는 DONE 이 된다', async () => {
    const { usecase, repository, github } = createUsecase();
    github.getItemLifecycle.mockResolvedValue({
      state: 'closed',
      closedAt: null,
      stateReason: null,
      mergedAt: null,
      isPullRequest: false,
    });
    await usecase.execute({ ownerId: 'U1', now });
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        transitionTo: ScheduleStatus.DONE,
        completedAt: now,
      }),
    );
  });

  it('404·조회 실패는 이슈를 그대로 둔다', async () => {
    const { usecase, repository, github } = createUsecase([issue(1), issue(2)]);
    github.getItemLifecycle
      .mockRejectedValueOnce(new Error('404'))
      .mockRejectedValueOnce(new Error('network'));
    await expect(
      usecase.execute({ ownerId: 'U1', now }),
    ).resolves.toBeUndefined();
    expect(repository.recordEventAndTransition).not.toHaveBeenCalled();
  });

  it('이벤트가 이미 있으면 전이하지 않는다', async () => {
    const { usecase, repository } = createUsecase();
    repository.recordEventAndTransition.mockResolvedValue('DUPLICATE');
    await usecase.execute({ ownerId: 'U1', now });
    expect(repository.recordEventAndTransition).toHaveBeenCalledTimes(1);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('20건 넘으면 다음 회차가 이어서 본다', async () => {
    const items = Array.from(
      { length: AUTO_COMPLETE_CHECK_MAX + 2 },
      (_, index) => issue(index + 1),
    ).reverse();
    const { usecase, github } = createUsecase(items);
    await usecase.execute({ ownerId: 'U1', now });
    expect(github.getItemLifecycle).toHaveBeenCalledTimes(
      AUTO_COMPLETE_CHECK_MAX,
    );
    expect(github.getItemLifecycle).toHaveBeenNthCalledWith(1, {
      repo: 'owner/repo',
      number: 1,
    });
    await usecase.execute({ ownerId: 'U1', now });
    expect(github.getItemLifecycle).toHaveBeenNthCalledWith(
      AUTO_COMPLETE_CHECK_MAX + 1,
      { repo: 'owner/repo', number: 21 },
    );
  });
});
