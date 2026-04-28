import { WeeklySummaryScheduler } from './weekly-summary.scheduler';

describe('WeeklySummaryScheduler', () => {
  const mockQueue = {
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    removeRepeatableByKey: jest.fn(),
    add: jest.fn(),
  };
  const mockConfig = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue.getRepeatableJobs.mockResolvedValue([]);
  });

  it('WEEKLY_SUMMARY_OWNER_SLACK_USER_ID 미설정 시 graceful skip', async () => {
    mockConfig.get.mockReturnValue(undefined);
    const scheduler = new WeeklySummaryScheduler(
      mockQueue as any,
      mockConfig as any,
    );
    await scheduler.onApplicationBootstrap();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('owner 설정 시 BullMQ repeatable job 등록', async () => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'WEEKLY_SUMMARY_OWNER_SLACK_USER_ID') {
        return 'U123';
      }
      return undefined;
    });
    const scheduler = new WeeklySummaryScheduler(
      mockQueue as any,
      mockConfig as any,
    );
    await scheduler.onApplicationBootstrap();
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'weekly-summary',
      { ownerSlackUserId: 'U123', target: 'U123' },
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: '0 17 * * 5' }),
      }),
    );
  });
});
