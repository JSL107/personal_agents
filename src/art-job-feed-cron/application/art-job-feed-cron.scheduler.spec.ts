import { ArtJobFeedCronScheduler } from './art-job-feed-cron.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([{ key: 'old' }]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

const makeConfig = (values: Record<string, string>) => ({
  get: jest.fn((key: string) => values[key]),
});

describe('ArtJobFeedCronScheduler', () => {
  it('채널 미설정이면 기존 repeatable 만 지우고 등록하지 않는다', async () => {
    const queue = makeQueue();
    const scheduler = new ArtJobFeedCronScheduler(
      queue as never,
      makeConfig({ ART_JOB_FEED_MENTION_USER_ID: 'U9' }) as never,
    );
    await scheduler.onApplicationBootstrap();
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('old');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('채널 설정 시 하루 2회 기본 cron 으로 등록하고 멘션·owner 를 싣는다', async () => {
    const queue = makeQueue();
    const scheduler = new ArtJobFeedCronScheduler(
      queue as never,
      makeConfig({
        ART_JOB_FEED_TARGET: ' C1 ',
        ART_JOB_FEED_MENTION_USER_ID: 'U9',
        AUTOPILOT_OWNER_SLACK_USER_ID: 'U1',
      }) as never,
    );
    await scheduler.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, payload, options] = queue.add.mock.calls[0];
    expect(payload).toEqual({
      target: 'C1',
      mentionUserId: 'U9',
      ownerSlackUserId: 'U1',
    });
    expect(options.repeat).toEqual({
      pattern: '0 9,18 * * *',
      tz: 'Asia/Seoul',
    });
  });
});
