import { ArtJobReminderPosting } from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import { ArtJobDeadlineCronConsumer } from './art-job-deadline-cron.consumer';

const POSTING: ArtJobReminderPosting = {
  id: 7,
  company: '그레이게임즈',
  title: '캐릭터 원화',
  detailUrl: 'https://www.gamejob.co.kr/x?GI_No=7',
  interestedBy: null,
};
const JOB = {
  data: { recipient: 'U_RECIPIENT', ownerSlackUserId: 'U_OWNER' },
} as never;

const makeConsumer = (
  due: ArtJobReminderPosting[],
  postMessage = jest.fn().mockResolvedValue({}),
) => {
  const repository = {
    findDueReminders: jest.fn().mockResolvedValue(due),
    markReminded: jest.fn().mockResolvedValue(undefined),
  };
  // 실제 가드처럼 키를 기억한다 — 같은 키의 두 번째 획득은 false.
  const acquired = new Set<string>();
  const cronIdempotency = {
    acquireOnce: jest.fn(async (key: string) => {
      if (acquired.has(key)) {
        return false;
      }
      acquired.add(key);
      return true;
    }),
    release: jest.fn(async (key: string) => {
      acquired.delete(key);
    }),
  };
  const notificationPublisher = {
    publishCronFailure: jest.fn(),
    publishRecovery: jest.fn(),
  };
  const consumer = new ArtJobDeadlineCronConsumer(
    repository as never,
    { postMessage } as never,
    cronIdempotency as never,
    notificationPublisher as never,
  );
  return {
    consumer,
    repository,
    postMessage,
    cronIdempotency,
    notificationPublisher,
  };
};

describe('ArtJobDeadlineCronConsumer', () => {
  beforeEach(() => {
    // 2026-10-19 09:00 KST
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 9, 19, 0)));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('내일 마감 관심 공고를 받는 사람에게 DM 한 통으로 보내고 장부에 보낸 시각을 남긴다', async () => {
    const deps = makeConsumer([POSTING]);

    await deps.consumer.process(JOB);

    const [deadline, remindedBefore] =
      deps.repository.findDueReminders.mock.calls[0];
    expect(deadline).toEqual({ year: 2026, month: 10, day: 20 });
    // 3시간 안에 보낸 것은 건너뛴다 — 같은 회차 재시도만 막는다.
    expect(remindedBefore).toEqual(new Date(Date.UTC(2026, 9, 18, 21)));
    expect(deps.postMessage).toHaveBeenCalledWith({
      kind: 'art-job-deadline',
      target: 'U_RECIPIENT',
      text: expect.stringContaining('내일 마감인 관심 공고 *1건*'),
      unfurlLinks: false,
    });
    expect(deps.repository.markReminded).toHaveBeenCalledWith(
      [7],
      new Date(Date.UTC(2026, 9, 19, 0)),
    );
    expect(deps.notificationPublisher.publishRecovery).toHaveBeenCalled();
  });

  it('보낼 공고가 없으면 DM 을 보내지 않는다', async () => {
    const deps = makeConsumer([]);

    await deps.consumer.process(JOB);

    expect(deps.postMessage).not.toHaveBeenCalled();
    expect(deps.repository.markReminded).not.toHaveBeenCalled();
  });

  it('같은 회차를 두 번 처리해도 한 번만 보낸다', async () => {
    const deps = makeConsumer([POSTING]);

    await deps.consumer.process(JOB);
    await deps.consumer.process(JOB);

    expect(deps.postMessage).toHaveBeenCalledTimes(1);
  });

  it('발송이 실패하면 가드를 풀고 장부에 남기지 않은 채 던진다 — 재시도가 다시 보낸다', async () => {
    const deps = makeConsumer(
      [POSTING],
      jest.fn().mockRejectedValue(new Error('slack down')),
    );

    await expect(deps.consumer.process(JOB)).rejects.toThrow('slack down');

    expect(deps.cronIdempotency.release).toHaveBeenCalled();
    expect(deps.repository.markReminded).not.toHaveBeenCalled();
    expect(deps.notificationPublisher.publishCronFailure).toHaveBeenCalled();
  });

  it('발송 뒤 장부 기록이 실패하면 재시도가 다시 보내지도, 해결 신호로 실패 알림을 덮지도 않는다', async () => {
    const deps = makeConsumer([POSTING]);
    deps.repository.markReminded.mockRejectedValueOnce(new Error('db down'));

    await expect(deps.consumer.process(JOB)).rejects.toThrow('db down');
    await deps.consumer.process(JOB);

    expect(deps.postMessage).toHaveBeenCalledTimes(1);
    expect(deps.notificationPublisher.publishCronFailure).toHaveBeenCalled();
    expect(deps.notificationPublisher.publishRecovery).not.toHaveBeenCalled();
  });

  it('누른 사람별로 한 통씩 보내고, 누른 사람 기록이 없으면 받는 사람에게 보낸다', async () => {
    const deps = makeConsumer([
      { ...POSTING, id: 1, interestedBy: 'U_OWNER' },
      { ...POSTING, id: 2, interestedBy: null },
      { ...POSTING, id: 3, interestedBy: 'U_OWNER' },
    ]);

    await deps.consumer.process(JOB);

    const sent = deps.postMessage.mock.calls.map(([call]) => {
      return [call.target, call.text.match(/\*(\d+)건\*/)[1]];
    });
    expect(sent).toEqual([
      ['U_OWNER', '2'],
      ['U_RECIPIENT', '1'],
    ]);
    expect(deps.repository.markReminded.mock.calls.map(([ids]) => ids)).toEqual(
      [[1, 3], [2]],
    );
  });

  it('한 사람에게 보내다 실패해도 나머지 사람에게는 보내고, 실패를 모아 던진다', async () => {
    const postMessage = jest.fn(async ({ target }: { target: string }) => {
      if (target === 'U_BROKEN') {
        throw new Error('user_not_found');
      }
      return {};
    });
    const deps = makeConsumer(
      [
        { ...POSTING, id: 1, interestedBy: 'U_BROKEN' },
        { ...POSTING, id: 2, interestedBy: 'U_OWNER' },
      ],
      postMessage,
    );

    await expect(deps.consumer.process(JOB)).rejects.toThrow(
      '마감 알림 1/2명 실패 — U_BROKEN: user_not_found',
    );
    expect(deps.repository.markReminded).toHaveBeenCalledWith(
      [2],
      expect.any(Date),
    );

    // 재시도: 보낸 사람은 가드로 건너뛰고 실패한 사람만 다시 시도한다.
    postMessage.mockClear();
    await expect(deps.consumer.process(JOB)).rejects.toThrow('U_BROKEN');
    expect(postMessage.mock.calls.map(([call]) => call.target)).toEqual([
      'U_BROKEN',
    ]);
  });
});
