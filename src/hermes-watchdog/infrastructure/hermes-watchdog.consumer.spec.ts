import { Job } from 'bullmq';

import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  HERMES_SNAPSHOT_INCIDENT_KEY,
  hermesJobIncidentKey,
} from '../../notification/domain/notification.type';
import { HermesWatchdogJobData } from '../domain/hermes-watchdog.type';
import { HermesJobsReader } from './hermes-jobs.reader';
import { HermesWatchdogConsumer } from './hermes-watchdog.consumer';

const OWNER = 'U123OWNER';

const buildJob = (): Job<HermesWatchdogJobData> =>
  ({ data: { ownerSlackUserId: OWNER } }) as Job<HermesWatchdogJobData>;

interface ConsumerHarness {
  consumer: HermesWatchdogConsumer;
  publishCronFailure: jest.Mock;
  publishRecovery: jest.Mock;
}

const buildConsumer = (read: jest.Mock): ConsumerHarness => {
  const publishCronFailure = jest.fn();
  const publishRecovery = jest.fn();
  const reader = { read } as unknown as HermesJobsReader;
  const publisher = {
    publishCronFailure,
    publishRecovery,
  } as unknown as NotificationPublisher;
  return {
    consumer: new HermesWatchdogConsumer(reader, publisher),
    publishCronFailure,
    publishRecovery,
  };
};

describe('HermesWatchdogConsumer', () => {
  it('이상이 없으면 알림을 보내지 않는다', async () => {
    const { consumer, publishCronFailure, publishRecovery } = buildConsumer(
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
    expect(publishRecovery).toHaveBeenCalledWith(HERMES_SNAPSHOT_INCIDENT_KEY);
    expect(publishRecovery).toHaveBeenCalledWith(
      hermesJobIncidentKey('아침신문'),
    );
    expect(publishRecovery).toHaveBeenCalledWith(
      hermesJobIncidentKey('scheduler'),
    );
  });

  it('실패한 job 이 있으면 owner 알림을 발행한다', async () => {
    const { consumer, publishCronFailure, publishRecovery } = buildConsumer(
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
      incidentKey: string;
      ownerSlackUserId: string;
      errorMessage: string;
    };
    expect(payload.ownerSlackUserId).toBe(OWNER);
    expect(payload.cronName).toBe('Hermes 아침신문');
    expect(payload.incidentKey).toBe(hermesJobIncidentKey('아침신문'));
    expect(publishRecovery).toHaveBeenCalledWith(HERMES_SNAPSHOT_INCIDENT_KEY);
    // 알람 제목이 "이대리 cron 실패" 로 고정이므로 본문 머리말로 Hermes 건임을 구분한다.
    expect(payload.errorMessage).toContain('Hermes(별도 프로세스)');
    expect(payload.errorMessage).toContain('아침신문');
    expect(payload.errorMessage).toContain('No Codex credentials stored.');
  });

  // 파일을 못 읽는 것 자체가 알려야 할 상태다 — 여기서 조용히 끝나면 감시자를 둔 의미가 없다.
  it('스냅샷을 못 읽으면 그 사실을 알림으로 올린다', async () => {
    const { consumer, publishCronFailure, publishRecovery } = buildConsumer(
      jest.fn().mockRejectedValue(new Error('ENOENT: no such file')),
    );

    await expect(consumer.process(buildJob())).resolves.toBeUndefined();

    expect(publishCronFailure).toHaveBeenCalledTimes(1);
    const payload = publishCronFailure.mock.calls[0][0] as {
      errorMessage: string;
    };
    expect(payload.errorMessage).toContain('읽지 못했습니다');
    expect(payload.errorMessage).toContain('ENOENT: no such file');
    expect(publishCronFailure.mock.calls[0][0].incidentKey).toBe(
      HERMES_SNAPSHOT_INCIDENT_KEY,
    );
    expect(publishRecovery).not.toHaveBeenCalled();
  });

  it('같은 job 의 여러 실패를 한 번만 알리고 id 로 사건을 식별한다', async () => {
    const { consumer, publishCronFailure, publishRecovery } = buildConsumer(
      jest.fn().mockResolvedValue({
        jobs: [
          {
            id: 'stable-id',
            name: '새 이름',
            enabled: true,
            last_status: 'error',
            last_error: 'boom',
            last_delivery_error: 'delivery',
            next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
          },
          {
            id: 'clean-id',
            name: '정상 작업',
            enabled: true,
            next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
          },
        ],
      }),
    );

    await consumer.process(buildJob());

    expect(publishCronFailure).toHaveBeenCalledTimes(1);
    expect(publishCronFailure.mock.calls[0][0]).toMatchObject({
      cronName: 'Hermes 새 이름',
      incidentKey: hermesJobIncidentKey('stable-id'),
    });
    expect(publishCronFailure.mock.calls[0][0].errorMessage).toContain(
      '전달 실패',
    );
    expect(publishRecovery).toHaveBeenCalledWith(
      hermesJobIncidentKey('clean-id'),
    );
    expect(publishRecovery).not.toHaveBeenCalledWith(
      hermesJobIncidentKey('stable-id'),
    );
  });

  it('여러 job 의 스케줄러 멈춤은 하나의 사건으로 알린다', async () => {
    const { consumer, publishCronFailure, publishRecovery } = buildConsumer(
      jest.fn().mockResolvedValue({
        jobs: [
          {
            id: 'first',
            name: '첫째',
            enabled: true,
            next_run_at: '2020-01-01T00:00:00Z',
          },
          {
            id: 'second',
            name: '둘째',
            enabled: true,
            next_run_at: '2020-01-01T00:00:00Z',
          },
        ],
      }),
    );

    await consumer.process(buildJob());

    expect(publishCronFailure).toHaveBeenCalledTimes(1);
    expect(publishCronFailure.mock.calls[0][0].incidentKey).toBe(
      hermesJobIncidentKey('scheduler'),
    );
    expect(publishRecovery).toHaveBeenCalledWith(hermesJobIncidentKey('first'));
    expect(publishRecovery).toHaveBeenCalledWith(
      hermesJobIncidentKey('second'),
    );
    expect(publishRecovery).not.toHaveBeenCalledWith(
      hermesJobIncidentKey('scheduler'),
    );
  });
});
