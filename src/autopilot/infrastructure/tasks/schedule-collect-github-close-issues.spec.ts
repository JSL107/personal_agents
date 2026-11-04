import { ScheduleCollectGithubAutopilotTask } from './schedule-collect-github.autopilot-task';

describe('GitHub 수집 후 이슈 완료 확인', () => {
  it('완료 확인이 실패해도 수집 task는 끝난다', async () => {
    const repository = {};
    const stateRepository = {
      markSucceeded: jest.fn().mockResolvedValue(undefined),
    };
    const assigned = { execute: jest.fn().mockResolvedValue({ issues: [] }) };
    const reconcile = {
      prepare: jest.fn().mockResolvedValue({}),
      apply: jest.fn().mockResolvedValue({ ok: true }),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'CONSOLE_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const closeIssues = {
      execute: jest.fn().mockRejectedValue(new Error('failed')),
    };
    const generateShortTitles = {
      execute: jest.fn().mockRejectedValue(new Error('failed')),
    };
    const task = Reflect.construct(ScheduleCollectGithubAutopilotTask, [
      repository,
      stateRepository,
      assigned,
      reconcile,
      config,
      closeIssues,
      generateShortTitles,
    ]) as ScheduleCollectGithubAutopilotTask;

    await expect(task.run()).resolves.toEqual({ skip: true });
    expect(generateShortTitles.execute).toHaveBeenCalledWith({ ownerId: 'U1' });
    expect(closeIssues.execute).toHaveBeenCalledWith({
      ownerId: 'U1',
      now: expect.any(Date),
    });
  });
});
