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
});
