import { AutopilotScheduler } from './autopilot.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('AutopilotScheduler', () => {
  it('owner 미설정 → 등록 0 + cleanup 호출', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const s = new AutopilotScheduler(queue as never, config as never);
    await s.onApplicationBootstrap();
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.getRepeatableJobs).toHaveBeenCalled();
  });

  it('owner 설정 → CRON 항목 등록(daily-eval)', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const s = new AutopilotScheduler(queue as never, config as never);
    await s.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledWith(
      'daily-eval',
      { ownerSlackUserId: 'U1', target: 'U1' },
      expect.objectContaining({
        repeat: { pattern: '0 19 * * *', tz: 'Asia/Seoul' },
      }),
    );
  });
});
