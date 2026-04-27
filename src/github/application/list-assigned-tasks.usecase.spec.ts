import { ConfigService } from '@nestjs/config';

import { GithubClientPort } from '../domain/port/github-client.port';
import { ListAssignedTasksUsecase } from './list-assigned-tasks.usecase';

const buildConfig = (env: Record<string, string | undefined>): ConfigService =>
  ({
    get: jest.fn((key: string) => env[key]),
  }) as unknown as ConfigService;

const buildClientMock = (
  fixture: Awaited<ReturnType<GithubClientPort['listMyAssignedTasks']>>,
): jest.Mocked<GithubClientPort> => ({
  listMyAssignedTasks: jest.fn().mockResolvedValue(fixture),
  getPullRequest: jest.fn(),
  getPullRequestDiff: jest.fn(),
  addIssueComment: jest.fn(),
});

describe('ListAssignedTasksUsecase', () => {
  it('GithubClient 호출 결과를 그대로 반환한다', async () => {
    const fixture = {
      issues: [
        {
          number: 1,
          title: 'i',
          repo: 'a/b',
          url: 'u',
          labels: [],
          updatedAt: 'x',
        },
      ],
      pullRequests: [],
    };
    const client = buildClientMock(fixture);
    const usecase = new ListAssignedTasksUsecase(client, buildConfig({}));

    const result = await usecase.execute({ limit: 10 });

    expect(result).toBe(fixture);
    expect(client.listMyAssignedTasks).toHaveBeenCalledTimes(1);
    const callArg = client.listMyAssignedTasks.mock.calls[0][0];
    expect(callArg).toMatchObject({ limit: 10 });
    // OPS-6 default 60일 cutoff 자동 주입 — YYYY-MM-DD 형식
    expect(callArg?.updatedSinceIsoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('options 없이 호출하면 cutoff 만 전달', async () => {
    const client = buildClientMock({ issues: [], pullRequests: [] });
    const usecase = new ListAssignedTasksUsecase(client, buildConfig({}));

    await usecase.execute();

    expect(client.listMyAssignedTasks).toHaveBeenCalledTimes(1);
    const callArg = client.listMyAssignedTasks.mock.calls[0][0];
    expect(callArg?.updatedSinceIsoDate).toBeDefined();
  });

  it('OPS-6: 호출자가 updatedSinceIsoDate 명시하면 cutoff 덮어쓰지 않음', async () => {
    const client = buildClientMock({ issues: [], pullRequests: [] });
    const usecase = new ListAssignedTasksUsecase(
      client,
      buildConfig({ STALE_DATA_CUTOFF_DAYS: '14' }),
    );
    const explicit = '2025-01-01';

    await usecase.execute({ updatedSinceIsoDate: explicit });

    expect(
      client.listMyAssignedTasks.mock.calls[0][0]?.updatedSinceIsoDate,
    ).toBe(explicit);
  });

  it('OPS-6: env STALE_DATA_CUTOFF_DAYS 가 cutoff 일수에 반영', async () => {
    const client = buildClientMock({ issues: [], pullRequests: [] });
    const usecase = new ListAssignedTasksUsecase(
      client,
      buildConfig({ STALE_DATA_CUTOFF_DAYS: '7' }),
    );

    await usecase.execute();

    const cutoff =
      client.listMyAssignedTasks.mock.calls[0][0]?.updatedSinceIsoDate;
    const cutoffMs = new Date(`${cutoff}T00:00:00.000Z`).getTime();
    const todayMs = new Date(
      new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z',
    ).getTime();
    const diffDays = (todayMs - cutoffMs) / (24 * 60 * 60 * 1000);
    // 7일 정확 (날짜 단위 절단이라 분/초 영향 없음)
    expect(diffDays).toBe(7);
  });
});
