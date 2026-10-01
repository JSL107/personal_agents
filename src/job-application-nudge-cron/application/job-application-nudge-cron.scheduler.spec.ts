import { JobApplicationNudgeCronScheduler } from './job-application-nudge-cron.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('JobApplicationNudgeCronScheduler', () => {
  it('owner 미설정이면 비활성(add 미호출)', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const scheduler = new JobApplicationNudgeCronScheduler(
      queue as never,
      config as never,
    );
    await scheduler.onApplicationBootstrap();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('owner 설정 시 repeatable 등록 (target 기본=owner)', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new JobApplicationNudgeCronScheduler(
      queue as never,
      config as never,
    );
    await scheduler.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({
      ownerSlackUserId: 'U1',
      target: 'U1',
    });
  });
});
