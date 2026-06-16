import { ResumeCalibrationCronScheduler } from './resume-calibration-cron.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('ResumeCalibrationCronScheduler', () => {
  it('owner 미설정이면 비활성(add 미호출)', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const scheduler = new ResumeCalibrationCronScheduler(
      queue as never,
      config as never,
    );
    await scheduler.onApplicationBootstrap();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('owner 설정 시 repeatable 등록', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'RESUME_CALIBRATION_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new ResumeCalibrationCronScheduler(
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
