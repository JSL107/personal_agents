import { NOTIFICATION_JOB } from '../domain/notification.type';
import {
  findMissingAlertOwnerKeys,
  NotificationConsumer,
  shouldFireAlert,
} from './notification.consumer';

const firstTime = new Date('2026-10-06T14:59:00.000Z');
const openRow = () => ({
  id: 1,
  key: 'cron:Study Brief Cron',
  label: 'Study Brief Cron',
  openedAt: firstTime,
  lastSeenAt: firstTime,
  lastNotifiedAt: firstTime,
  occurrences: 1,
  lastError: 'first',
  causes: ['first'],
  resolvedAt: null,
});

describe('NotificationConsumer', () => {
  const setup = () => {
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const findUnique = jest.fn().mockResolvedValue(null);
    const upsert = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const add = jest.fn().mockResolvedValue(undefined);
    const get = jest.fn().mockReturnValue('U-owner');
    const consumer = new NotificationConsumer(
      { postMessage } as never,
      { get } as never,
      { alertIncident: { findUnique, upsert, update } } as never,
      { add } as never,
    );
    return { consumer, postMessage, findUnique, upsert, update, add, get };
  };
  const failure = () =>
    ({
      name: NOTIFICATION_JOB.CRON_FAILURE,
      data: {
        cronName: 'Study Brief Cron',
        ownerSlackUserId: 'U1',
        errorMessage: 'boom 312.4s',
      },
    }) as never;
  const recovery = () => ({
    name: NOTIFICATION_JOB.INCIDENT_RECOVERED,
    data: { incidentKey: 'cron:Study Brief Cron' },
    removeDeduplicationKey: jest.fn().mockResolvedValue(true),
  });
  afterEach(() => jest.useRealTimers());

  it('OPEN 은 DM 성공 후 기록하고 실패 시 기록하지 않는다', async () => {
    const { consumer, postMessage, upsert } = setup();
    await consumer.process(failure());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'alert:cron-failure',
        text: expect.stringContaining('고장 발생'),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'cron:Study Brief Cron' } }),
    );
    expect(postMessage.mock.invocationCallOrder[0]).toBeLessThan(
      upsert.mock.invocationCallOrder[0],
    );
    postMessage.mockRejectedValue(new Error('slack down'));
    await consumer.process(failure());
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('SILENT 는 횟수를 늘리고 REMIND DM 실패는 발송 시각을 보존한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T14:59:30.000Z'));
    const { consumer, findUnique, postMessage, update } = setup();
    findUnique.mockResolvedValue(openRow());
    await consumer.process(failure());
    expect(postMessage).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ occurrences: 2 }),
      }),
    );
    jest.setSystemTime(new Date('2026-10-06T15:01:00.000Z'));
    postMessage.mockRejectedValue(new Error('slack down'));
    await consumer.process(failure());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('아직 고장 중'),
      }),
    );
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ lastNotifiedAt: expect.any(Date) }),
      }),
    );
  });

  it('REMIND DM 성공 시 발송 시각을 갱신한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T15:01:00.000Z'));
    const { consumer, findUnique, update } = setup();
    findUnique.mockResolvedValue(openRow());
    await consumer.process(failure());
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          occurrences: 2,
          lastNotifiedAt: new Date('2026-10-06T15:01:00.000Z'),
        }),
      }),
    );
  });

  it('SILENT 기록 실패 시 DB 장애 fallback DM 을 보낸다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T14:59:30.000Z'));
    const { consumer, findUnique, update, postMessage } = setup();
    findUnique.mockResolvedValue(openRow());
    update.mockRejectedValue(new Error('db down'));
    await consumer.process(failure());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('사건 원장 접근 실패'),
      }),
    );
  });

  it('조용한 시간 전 recovery 는 중복 제거 없이 지연 재등록한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T15:00:00.000Z'));
    const { consumer, findUnique, postMessage, update, add } = setup();
    findUnique.mockResolvedValue(openRow());
    const job = recovery();
    await consumer.process(job as never);
    expect(add).toHaveBeenCalledWith(
      NOTIFICATION_JOB.INCIDENT_RECOVERED,
      job.data,
      expect.objectContaining({ delay: 29 * 60_000 }),
    );
    // 지연 job 이 dedup 키를 쥐면 더 최신 성공 신호가 버려진다(PR #745 리뷰).
    expect(add.mock.calls[0][2]).not.toHaveProperty('deduplication');
    expect(postMessage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('실패 → 성공 → 재실패 → 최신 성공이면 최신 성공의 지연 확인이 사건을 닫는다', async () => {
    const { consumer, findUnique, postMessage, update, add } = setup();
    const reFailedAt = new Date('2026-10-06T15:10:00.000Z');
    findUnique.mockResolvedValue({ ...openRow(), lastSeenAt: reFailedAt });
    // 옛 성공(재실패 이전)의 지연 확인은 낡은 신호로 버려진다.
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T15:29:00.000Z'));
    await consumer.process({
      ...recovery(),
      data: {
        incidentKey: 'cron:Study Brief Cron',
        succeededAt: new Date('2026-10-06T15:00:00.000Z').getTime(),
      },
    } as never);
    expect(postMessage).not.toHaveBeenCalled();
    // 최신 성공(재실패 이후)은 따로 지연 등록되고, 조용한 시간이 지나면 사건을 닫는다.
    const latest = {
      ...recovery(),
      data: {
        incidentKey: 'cron:Study Brief Cron',
        succeededAt: new Date('2026-10-06T15:15:00.000Z').getTime(),
      },
    };
    jest.setSystemTime(new Date('2026-10-06T15:15:00.000Z'));
    await consumer.process(latest as never);
    expect(add).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-10-06T15:40:00.000Z'));
    await consumer.process(latest as never);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('해결') }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt: expect.any(Date) } }),
    );
  });

  it('recovery 의 원장 조회 실패는 삼키지 않고 던져 재시도시킨다', async () => {
    const { consumer, findUnique, postMessage } = setup();
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(consumer.process(recovery() as never)).rejects.toThrow(
      'db down',
    );
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('지연 재등록 실패는 BullMQ 재시도를 위해 전파한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T15:00:00.000Z'));
    const { consumer, findUnique, add } = setup();
    findUnique.mockResolvedValue(openRow());
    add.mockRejectedValue(new Error('redis down'));
    await expect(consumer.process(recovery() as never)).rejects.toThrow(
      'redis down',
    );
  });

  it('조용한 시간 후 recovery 는 DM 성공 후 닫고 DM 실패면 열어 둔다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T15:29:00.000Z'));
    const { consumer, findUnique, postMessage, update } = setup();
    findUnique.mockResolvedValue(openRow());
    await consumer.process(recovery() as never);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('해결') }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt: expect.any(Date) } }),
    );
    expect(postMessage.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
    postMessage.mockRejectedValue(new Error('slack down'));
    await consumer.process(recovery() as never);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('마지막 실패보다 이른 성공 신호는 낡은 것으로 버린다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T16:00:00.000Z'));
    const { consumer, findUnique, postMessage, update, add } = setup();
    findUnique.mockResolvedValue(openRow());
    const job = {
      ...recovery(),
      data: {
        incidentKey: 'cron:Study Brief Cron',
        succeededAt: firstTime.getTime() - 60_000,
      },
    };
    await consumer.process(job as never);
    expect(postMessage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('실패 시각은 처리 시각이 아니라 신고(job 생성) 시각으로 남긴다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-06T15:10:00.000Z'));
    const { consumer, findUnique, update } = setup();
    findUnique.mockResolvedValue(openRow());
    const reportedAt = new Date('2026-10-06T15:05:00.000Z');
    await consumer.process({
      ...(failure() as object),
      timestamp: reportedAt.getTime(),
    } as never);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSeenAt: reportedAt }),
      }),
    );
  });

  it('열린 사건 없는 recovery 와 owner 없는 실패는 DM·기록 없음', async () => {
    const { consumer, postMessage, upsert, get } = setup();
    await consumer.process(recovery() as never);
    get.mockReturnValue(undefined);
    await consumer.process(failure());
    expect(postMessage).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('DB 실패 시 fallback 으로 한 번 보내고 30분 내 중복은 억제한다', async () => {
    const { consumer, findUnique, postMessage } = setup();
    findUnique.mockRejectedValue(new Error('db down'));
    await consumer.process(failure());
    await consumer.process(failure());
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('사건 원장 접근 실패'),
      }),
    );
    await expect(consumer.process(recovery() as never)).rejects.toThrow(
      'db down',
    );
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('claude 실패 kind 와 누락 owner 설정을 확인한다', async () => {
    const { consumer, postMessage } = setup();
    await consumer.process({
      name: NOTIFICATION_JOB.CLAUDE_AUTH_SUSPECT,
      data: { exitMessage: 'auth failed' },
    } as never);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'alert:claude-auth' }),
    );
    expect(
      findMissingAlertOwnerKeys({
        CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID: ' ',
        CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID: 'U1',
      }),
    ).toEqual(['CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID']);
  });
});

describe('shouldFireAlert', () => {
  it('DB 장애 fallback 에서 30분만 중복을 억제한다', () => {
    expect(shouldFireAlert({ lastFiredAtMs: null, nowMs: 0 })).toBe(true);
    expect(shouldFireAlert({ lastFiredAtMs: 0, nowMs: 29 * 60_000 })).toBe(
      false,
    );
    expect(shouldFireAlert({ lastFiredAtMs: 0, nowMs: 30 * 60_000 })).toBe(
      true,
    );
  });
});
