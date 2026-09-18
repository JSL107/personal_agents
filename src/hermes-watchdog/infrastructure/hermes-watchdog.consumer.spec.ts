import { Job } from 'bullmq';

import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { HermesWatchdogJobData } from '../domain/hermes-watchdog.type';
import { HermesJobsReader } from './hermes-jobs.reader';
import { HermesWatchdogConsumer } from './hermes-watchdog.consumer';

const OWNER = 'U123OWNER';

const buildJob = (): Job<HermesWatchdogJobData> =>
  ({ data: { ownerSlackUserId: OWNER } }) as Job<HermesWatchdogJobData>;

interface ConsumerHarness {
  consumer: HermesWatchdogConsumer;
  publishCronFailure: jest.Mock;
}

const buildConsumer = (read: jest.Mock): ConsumerHarness => {
  const publishCronFailure = jest.fn();
  const reader = { read } as unknown as HermesJobsReader;
  const publisher = {
    publishCronFailure,
  } as unknown as NotificationPublisher;
  return {
    consumer: new HermesWatchdogConsumer(reader, publisher),
    publishCronFailure,
  };
};

describe('HermesWatchdogConsumer', () => {
  it('이상이 없으면 알림을 보내지 않는다', async () => {
    const { consumer, publishCronFailure } = buildConsumer(
      jest.fn().mockResolvedValue({
        jobs: [
          {
            name: '아침신문',
            enabled: true,
            last_status: 'ok',
            next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
          },
        ],
      }),
    );

    await consumer.process(buildJob());

    expect(publishCronFailure).not.toHaveBeenCalled();
  });

  it('실패한 job 이 있으면 owner 알림을 발행한다', async () => {
    const { consumer, publishCronFailure } = buildConsumer(
      jest.fn().mockResolvedValue({
        jobs: [
          {
            name: '아침신문',
            enabled: true,
            last_status: 'error',
            last_error: 'No Codex credentials stored.',
            next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
          },
        ],
      }),
    );

    await consumer.process(buildJob());

    expect(publishCronFailure).toHaveBeenCalledTimes(1);
    const payload = publishCronFailure.mock.calls[0][0] as {
      cronName: string;
      ownerSlackUserId: string;
      errorMessage: string;
    };
    expect(payload.ownerSlackUserId).toBe(OWNER);
    // 알람 제목이 "이대리 cron 실패" 로 고정이므로 본문 머리말로 Hermes 건임을 구분한다.
    expect(payload.errorMessage).toContain('Hermes(별도 프로세스)');
    expect(payload.errorMessage).toContain('아침신문');
    expect(payload.errorMessage).toContain('No Codex credentials stored.');
  });

  // 파일을 못 읽는 것 자체가 알려야 할 상태다 — 여기서 조용히 끝나면 감시자를 둔 의미가 없다.
  it('스냅샷을 못 읽으면 그 사실을 알림으로 올린다', async () => {
    const { consumer, publishCronFailure } = buildConsumer(
      jest.fn().mockRejectedValue(new Error('ENOENT: no such file')),
    );

    await expect(consumer.process(buildJob())).resolves.toBeUndefined();

    expect(publishCronFailure).toHaveBeenCalledTimes(1);
    const payload = publishCronFailure.mock.calls[0][0] as {
      errorMessage: string;
    };
    expect(payload.errorMessage).toContain('읽지 못했습니다');
    expect(payload.errorMessage).toContain('ENOENT: no such file');
  });
});
