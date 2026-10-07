import { NOTIFICATION_JOB } from '../domain/notification.type';
import { NotificationPublisher } from './notification-publisher.service';

describe('NotificationPublisher', () => {
  it('recovery 신호를 같은 key 의 deduplication 으로 큐에 넣는다', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const publisher = new NotificationPublisher({ add } as never);
    publisher.publishRecovery('task:one');
    await Promise.resolve();
    expect(add).toHaveBeenCalledWith(
      NOTIFICATION_JOB.INCIDENT_RECOVERED,
      { incidentKey: 'task:one', succeededAt: expect.any(Number) },
      expect.objectContaining({
        deduplication: { id: 'recovery:task:one', keepLastIfActive: true },
        attempts: 2,
      }),
    );
  });

  it('큐 오류는 호출자에게 전파하지 않는다', async () => {
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    const publisher = new NotificationPublisher({ add } as never);
    expect(() => publisher.publishRecovery('task:one')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('지연 해결 확인은 중복 제거 없이 남은 시간 뒤로 넣고, 큐 오류는 호출자에게 던진다', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const publisher = new NotificationPublisher({ add } as never);
    const data = { incidentKey: 'task:one', succeededAt: 1 };
    await publisher.publishDelayedRecovery(data, 60_000);
    expect(add).toHaveBeenCalledWith(
      NOTIFICATION_JOB.INCIDENT_RECOVERED,
      data,
      expect.objectContaining({ delay: 60_000 }),
    );
    // 지연 job 이 dedup 키를 쥐면 더 최신 성공 신호가 버려진다(PR #745 리뷰).
    expect(add.mock.calls[0][2]).not.toHaveProperty('deduplication');

    add.mockRejectedValue(new Error('redis down'));
    await expect(
      publisher.publishDelayedRecovery(data, 60_000),
    ).rejects.toThrow('redis down');
  });
});
