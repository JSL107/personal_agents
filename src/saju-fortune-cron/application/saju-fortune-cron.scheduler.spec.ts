import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { SajuFortuneCronScheduler } from './saju-fortune-cron.scheduler';

const buildScheduler = (env: Record<string, string>) => {
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = {
    add,
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    removeRepeatableByKey: jest.fn(),
    getDelayed: jest.fn().mockResolvedValue([]),
  } as unknown as Queue;
  const configService = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return { add, scheduler: new SajuFortuneCronScheduler(queue, configService) };
};

describe('SajuFortuneCronScheduler', () => {
  it('발송 시각이 같은 사람끼리 묶어 시각마다 잡을 하나씩 등록한다', async () => {
    const { add, scheduler } = buildScheduler({
      SAJU_FORTUNE_OWNER_SLACK_USER_ID: 'U111',
      SAJU_FORTUNE_RECIPIENTS: [
        'U111|길동|丙寅 辛卯 壬戌 庚子|07:30',
        'U222|철수|戊辰 甲寅 癸亥',
        'U333|영희|戊辰 甲寅 癸亥',
      ].join(';'),
    });

    await scheduler.onApplicationBootstrap();

    const registered = add.mock.calls.map(([, payload, options]) => ({
      cron: options.repeat.pattern,
      ids: payload.recipientSlackUserIds,
    }));
    expect(registered).toEqual([
      { cron: '30 7 * * *', ids: ['U111'] },
      { cron: '0 8 * * *', ids: ['U222', 'U333'] },
    ]);
    expect(JSON.stringify(add.mock.calls)).not.toContain('丙寅');
  });

  it('owner 가 없으면 등록하지 않는다', async () => {
    const { add, scheduler } = buildScheduler({
      SAJU_FORTUNE_RECIPIENTS: 'U222|철수|戊辰 甲寅 癸亥',
    });

    await scheduler.onApplicationBootstrap();

    expect(add).not.toHaveBeenCalled();
  });
});
