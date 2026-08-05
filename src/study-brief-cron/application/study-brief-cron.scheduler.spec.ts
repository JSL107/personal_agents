import { StudyBriefCronScheduler } from './study-brief-cron.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([{ key: 'old-job' }]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('StudyBriefCronScheduler', () => {
  it('owner 미설정이면 기존 repeatable을 정리하고 등록하지 않는다', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const scheduler = new StudyBriefCronScheduler(
      queue as never,
      config as never,
    );

    await scheduler.onApplicationBootstrap();

    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('old-job');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('owner 설정 시 env의 기본값과 다른 cron/timezone으로 repeatable을 등록한다', async () => {
    const queue = makeQueue();
    const values: Record<string, string> = {
      STUDY_BRIEF_OWNER_SLACK_USER_ID: 'U1',
      STUDY_BRIEF_TARGET: 'C1',
      STUDY_BRIEF_CRON: '17 11 * * 2',
      STUDY_BRIEF_TIMEZONE: 'America/New_York',
    };
    const config = { get: jest.fn((key: string) => values[key]) };
    const scheduler = new StudyBriefCronScheduler(
      queue as never,
      config as never,
    );

    await scheduler.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledWith(
      'study-brief-cron',
      { ownerSlackUserId: 'U1', target: 'C1' },
      expect.objectContaining({
        repeat: { pattern: '17 11 * * 2', tz: 'America/New_York' },
        attempts: 2,
      }),
    );
  });
});
