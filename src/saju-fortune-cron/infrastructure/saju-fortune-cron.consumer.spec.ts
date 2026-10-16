import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { SlackNotifierPort } from '../../slack/domain/port/slack-notifier.port';
import { SajuFortuneCronJobData } from '../domain/saju-fortune-cron.type';
import { SajuFortuneCronConsumer } from './saju-fortune-cron.consumer';

const RECIPIENTS = 'U111|길동|丙寅 辛卯 壬戌 庚子;U222|철수|戊辰 甲寅 癸亥';
const JOB = {
  data: { ownerSlackUserId: 'U111', recipientSlackUserIds: ['U111', 'U222'] },
} as Job<SajuFortuneCronJobData>;

describe('SajuFortuneCronConsumer', () => {
  let route: jest.Mock;
  let postMessage: jest.Mock;
  let acquireOnce: jest.Mock;
  let release: jest.Mock;
  let isDone: jest.Mock;
  let publishCronFailure: jest.Mock;
  let consumer: SajuFortuneCronConsumer;

  beforeEach(() => {
    route = jest
      .fn()
      .mockResolvedValue({ text: '🌊 물이 물을 만난 날 <!channel>' });
    postMessage = jest.fn().mockResolvedValue(undefined);
    acquireOnce = jest.fn().mockResolvedValue(true);
    release = jest.fn().mockResolvedValue(undefined);
    isDone = jest.fn().mockResolvedValue(false);
    publishCronFailure = jest.fn();
    consumer = new SajuFortuneCronConsumer(
      { get: () => RECIPIENTS } as unknown as ConfigService,
      { route } as unknown as ModelRouterUsecase,
      { postMessage } as unknown as SlackNotifierPort,
      { acquireOnce, release, isDone } as unknown as CronIdempotencyService,
      {
        publishCronFailure,
        publishRecovery: jest.fn(),
      } as unknown as NotificationPublisher,
    );
  });

  it('받는 사람마다 PM 을 빌려 머리말 없이 부르고, 각자에게 이스케이프된 DM 을 보낸다', async () => {
    await consumer.process(JOB);

    expect(route).toHaveBeenCalledTimes(2);
    expect(route.mock.calls[0][0]).toMatchObject({
      agentType: AgentType.PM,
      noContractPreamble: true,
    });
    expect(postMessage.mock.calls.map(([input]) => input.target)).toEqual([
      'U111',
      'U222',
    ]);
    const text: string = postMessage.mock.calls[0][0].text;
    expect(text).toMatch(/^🔮 \*오늘의 운세 — \d{4}-\d{2}-\d{2} \(..일\)\*/);
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).not.toContain('丙寅');
  });

  it('한 사람의 LLM 이 실패해도 다른 사람은 받고, 실패한 사람은 가드를 잡지 않은 채 owner 에게 알린다', async () => {
    route
      .mockRejectedValueOnce(new Error('codex 쿼터'))
      .mockResolvedValueOnce({ text: '좋은 날' });

    await expect(consumer.process(JOB)).rejects.toThrow(
      '사주 운세 발송 실패 1/2명: 길동',
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].target).toBe('U222');
    expect(acquireOnce).toHaveBeenCalledTimes(1);
    expect(acquireOnce.mock.calls[0][0]).toContain(':U222:');
    expect(publishCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSlackUserId: 'U111' }),
    );
  });

  it('발송이 실패하면 잡았던 가드를 풀어 재시도가 다시 보내게 한다', async () => {
    postMessage.mockRejectedValueOnce(new Error('slack 500'));

    await expect(consumer.process(JOB)).rejects.toThrow('1/2명: 길동');

    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toContain(':U111:');
  });

  it('이 잡이 맡은 시각의 사람에게만 보낸다', async () => {
    await consumer.process({
      data: { ownerSlackUserId: 'U111', recipientSlackUserIds: ['U222'] },
    } as Job<SajuFortuneCronJobData>);

    expect(route).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls.map(([input]) => input.target)).toEqual([
      'U222',
    ]);
  });

  it('오늘 이미 보낸 사람은 LLM 도 부르지 않는다', async () => {
    isDone.mockResolvedValue(true);

    await consumer.process(JOB);

    expect(route).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
