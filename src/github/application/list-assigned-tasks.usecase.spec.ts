import { GithubClientPort } from '../domain/port/github-client.port';
import { ListAssignedTasksUsecase } from './list-assigned-tasks.usecase';

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
    const client: jest.Mocked<GithubClientPort> = {
      listMyAssignedTasks: jest.fn().mockResolvedValue(fixture),
      getPullRequest: jest.fn(),
      getPullRequestDiff: jest.fn(),
    };
    const usecase = new ListAssignedTasksUsecase(client);

    const result = await usecase.execute({ limit: 10 });

    expect(result).toBe(fixture);
    expect(client.listMyAssignedTasks).toHaveBeenCalledWith({ limit: 10 });
  });

  it('options 없이 호출하면 client 에 undefined 그대로 전달', async () => {
    const client: jest.Mocked<GithubClientPort> = {
      listMyAssignedTasks: jest
        .fn()
        .mockResolvedValue({ issues: [], pullRequests: [] }),
      getPullRequest: jest.fn(),
      getPullRequestDiff: jest.fn(),
    };
    const usecase = new ListAssignedTasksUsecase(client);

    await usecase.execute();

    expect(client.listMyAssignedTasks).toHaveBeenCalledWith(undefined);
  });
});
