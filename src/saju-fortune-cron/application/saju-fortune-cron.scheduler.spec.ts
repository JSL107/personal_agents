import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { SajuFortuneJobName } from '../domain/saju-fortune-cron.type';
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
      SAJU_FORTUNE_RECIPIENTS: [
        'U111|길동|丙寅 辛卯 壬戌 庚子|07:30',
        'U222|철수|戊辰 甲寅 癸亥',
        'U333|영희|戊辰 甲寅 癸亥',
      ].join(';'),
    });

    await scheduler.onApplicationBootstrap();

    const registered = add.mock.calls
      .filter(([name]) => name === SajuFortuneJobName.DAILY)
      .map(([, payload, options]) => ({
        cron: options.repeat.pattern,
        ids: payload.recipientSlackUserIds,
      }));
    expect(registered).toEqual([
      { cron: '30 7 * * *', ids: ['U111'] },
      { cron: '0 8 * * *', ids: ['U222', 'U333'] },
    ]);
    expect(JSON.stringify(add.mock.calls)).not.toContain('丙寅');
  });

  it('유효한 받는 사람이 없으면 등록하지 않는다', async () => {
    const { add, scheduler } = buildScheduler({
      SAJU_FORTUNE_RECIPIENTS: 'U222|철수|甲丑 甲寅 癸亥',
    });

    await scheduler.onApplicationBootstrap();

    expect(add).not.toHaveBeenCalled();
  });

  it('아침 잡 이름 값은 그대로 saju-fortune-cron 이다', () => {
    // 이미 등록된 반복·보충 잡이 이 이름으로 남아 있다 — 바꾸면 아침 잡이 갈래를 못 찾는다.
    expect(SajuFortuneJobName.DAILY).toBe('saju-fortune-cron');
  });

  it('저녁 미션 확인 잡을 빈 데이터·기본 0 21 * * * 로 단다', async () => {
    const { add, scheduler } = buildScheduler({
      SAJU_FORTUNE_RECIPIENTS: 'U222|철수|戊辰 甲寅 癸亥',
    });

    await scheduler.onApplicationBootstrap();

    const evening = add.mock.calls.filter(
      ([name]) => name === SajuFortuneJobName.MISSION_CHECK,
    );
    expect(evening).toHaveLength(1);
    const [, payload, options] = evening[0];
    expect(payload).toEqual({});
    expect(options).toMatchObject({
      repeat: { pattern: '0 21 * * *', tz: 'Asia/Seoul' },
      jobId: 'saju-mission-check',
      attempts: 2,
    });
  });

  it('SAJU_MISSION_CHECK_CRON 으로 시각을 바꾼다', async () => {
    const { add, scheduler } = buildScheduler({
      SAJU_FORTUNE_RECIPIENTS: 'U222|철수|戊辰 甲寅 癸亥',
      SAJU_MISSION_CHECK_CRON: '30 20 * * *',
    });

    await scheduler.onApplicationBootstrap();

    const evening = add.mock.calls.find(
      ([name]) => name === SajuFortuneJobName.MISSION_CHECK,
    );
    expect(evening?.[2].repeat.pattern).toBe('30 20 * * *');
  });

  it('SAJU_MISSION_CHECK_CRON=off 면 저녁 잡을 달지 않는다', async () => {
    const { add, scheduler } = buildScheduler({
      SAJU_FORTUNE_RECIPIENTS: 'U222|철수|戊辰 甲寅 癸亥',
      SAJU_MISSION_CHECK_CRON: 'off',
    });

    await scheduler.onApplicationBootstrap();

    expect(
      add.mock.calls.some(
        ([name]) => name === SajuFortuneJobName.MISSION_CHECK,
      ),
    ).toBe(false);
  });
});
