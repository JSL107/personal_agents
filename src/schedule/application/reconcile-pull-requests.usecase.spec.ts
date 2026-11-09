import { ConfigService } from '@nestjs/config';

import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleCollectionStateRepositoryPort } from '../domain/port/schedule-collection-state.repository.port';
import {
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { ReconcilePullRequestsUsecase } from './reconcile-pull-requests.usecase';

const now = new Date('2026-11-04T08:00:00Z');
const mergedAt = '2026-11-04T05:00:00Z';
const pullRequest = {
  repo: 'Acme/API',
  number: 4,
  url: 'https://github.com/Acme/API/pull/4',
  title: '결제 API',
  body: '',
  state: 'merged',
  mergedAt,
  updatedAt: '2026-11-04T05:00:00Z',
  createdAt: '2026-11-03T00:00:00Z',
};

describe('ReconcilePullRequestsUsecase', () => {
  const repository = {
    findBySource: jest.fn(),
    findAllByOwner: jest.fn(),
    findBySourceKey: jest.fn(),
    createCollected: jest.fn(),
    addEvent: jest.fn(),
    findDetail: jest.fn(),
    recordEventAndTransition: jest.fn(),
  };
  const stateRepository = { get: jest.fn() };
  const github = {
    listAuthorOpenPullRequests: jest.fn(),
    listAuthorMergedPullRequestsSince: jest.fn(),
    getItemLifecycle: jest.fn(),
  };
  const config = { get: jest.fn() };
  const makeUsecase = () =>
    new ReconcilePullRequestsUsecase(
      repository as unknown as ScheduleRepositoryPort,
      stateRepository as unknown as ScheduleCollectionStateRepositoryPort,
      github as unknown as GithubClientPort,
      config as unknown as ConfigService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue('JSL107');
    stateRepository.get.mockResolvedValue(null);
    github.listAuthorOpenPullRequests.mockResolvedValue([]);
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([]);
    repository.findBySource.mockResolvedValue([]);
    repository.findAllByOwner.mockResolvedValue([]);
    repository.findBySourceKey.mockResolvedValue(null);
    repository.createCollected.mockResolvedValue({ id: 5 });
    repository.recordEventAndTransition.mockResolvedValue({
      item: { id: 5 },
      transitioned: true,
    });
  });

  it('머지된 PR 은 mergedAt 을 완료 시각으로 DONE 이 된다', async () => {
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([pullRequest]);
    const result = await makeUsecase().execute({ ownerId: 'U1', now });
    expect(result).toEqual({ ok: true });
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: ScheduleEventKind.PR_MERGED }),
        transitionTo: ScheduleStatus.DONE,
        completedAt: new Date(mergedAt),
      }),
    );
  });

  it('열린 PR 은 갱신일 하한 없이, 머지 PR 은 수집 하한부터 조회한다', async () => {
    stateRepository.get.mockResolvedValue(new Date('2026-11-04T00:00:00Z'));
    await makeUsecase().execute({ ownerId: 'U1', now });
    expect(github.listAuthorOpenPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({ sinceIsoDate: '1970-01-01' }),
    );
    expect(github.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith(
      expect.objectContaining({ sinceIsoDate: '2026-11-03T22:00:00.000Z' }),
    );
  });
  it('수집 전부터 멈춰 있던 열린 PR 도 진행 중 일로 등록한다', async () => {
    github.listAuthorOpenPullRequests.mockResolvedValue([
      {
        ...pullRequest,
        state: 'open',
        mergedAt: null,
        updatedAt: '2026-06-05T00:00:00Z',
        createdAt: '2026-06-05T00:00:00Z',
      },
    ]);
    await makeUsecase().execute({ ownerId: 'U1', now });
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ScheduleSource.GITHUB_PR,
        status: ScheduleStatus.IN_PROGRESS,
        startedAt: new Date('2026-06-05T00:00:00Z'),
      }),
    );
  });
  it('조회 실패 시 아무 행도 바꾸지 않고 ok=false', async () => {
    github.listAuthorOpenPullRequests.mockRejectedValue(new Error('network'));
    const result = await makeUsecase().execute({ ownerId: 'U1', now });
    expect(result).toEqual({ ok: false });
    expect(repository.createCollected).not.toHaveBeenCalled();
    expect(repository.recordEventAndTransition).not.toHaveBeenCalled();
  });

  it('설정 조회가 실패해도 예외 없이 ok=false를 반환한다', async () => {
    config.get.mockImplementation(() => {
      throw new Error('config');
    });
    await expect(
      makeUsecase().execute({ ownerId: 'U1', now }),
    ).resolves.toEqual({ ok: false });
  });

  it('작성자 설정이 없으면 PR 저장소를 조회하지 않는다', async () => {
    config.get.mockReturnValue(undefined);
    await expect(
      makeUsecase().execute({ ownerId: 'U1', now }),
    ).resolves.toEqual({ ok: true });
    expect(repository.findAllByOwner).not.toHaveBeenCalled();
  });

  it('이미 PR_MERGED 이벤트가 있으면 전이하지 않는다', async () => {
    repository.findBySource.mockResolvedValue([
      {
        id: 5,
        status: ScheduleStatus.IN_PROGRESS,
        source: ScheduleSource.GITHUB_PR,
        sourceKey: pullRequest.url,
      },
    ]);
    github.getItemLifecycle.mockResolvedValue({
      state: 'closed',
      mergedAt,
      closedAt: mergedAt,
      stateReason: 'completed',
      isPullRequest: true,
    });
    repository.recordEventAndTransition.mockResolvedValue('DUPLICATE');
    const result = await makeUsecase().execute({ ownerId: 'U1', now });
    expect(result).toEqual({ ok: true });
    expect(repository.recordEventAndTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: ScheduleEventKind.PR_MERGED }),
        completedAt: new Date(mergedAt),
      }),
    );
  });
});
