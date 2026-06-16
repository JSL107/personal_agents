import { JobApplicationRecord } from '../../agent/job-application/domain/job-application.type';
import { JobApplicationNudgeCronConsumer } from './job-application-nudge-cron.consumer';

const sampleRecord = (): JobApplicationRecord => ({
  id: 1,
  slackUserId: 'U1',
  company: '토스',
  role: '백엔드',
  jdUrl: null,
  status: 'APPLIED',
  appliedAt: { year: 2026, month: 6, day: 10 },
  deadline: { year: 2026, month: 6, day: 18 },
  nextFollowUpAt: null,
  notes: null,
  createdAt: new Date(),
});

const makeConsumer = (due: JobApplicationRecord[]) => {
  const repository = {
    findDueNudges: jest.fn().mockResolvedValue(due),
  };
  const slackNotifier = { postMessage: jest.fn().mockResolvedValue(undefined) };
  const cronIdempotency = { acquireOnce: jest.fn().mockResolvedValue(true) };
  const notificationPublisher = { publishCronFailure: jest.fn() };
  const consumer = new JobApplicationNudgeCronConsumer(
    repository as never,
    slackNotifier as never,
    cronIdempotency as never,
    notificationPublisher as never,
  );
  return { consumer, repository, slackNotifier, notificationPublisher };
};

describe('JobApplicationNudgeCronConsumer', () => {
  it('due 있음 — findDueNudges 인자 전달 + Slack 발송 1회 (넛지 헤더 포함)', async () => {
    const deps = makeConsumer([sampleRecord()]);
    await deps.consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as never);

    expect(deps.repository.findDueNudges).toHaveBeenCalledTimes(1);
    const findArg = deps.repository.findDueNudges.mock.calls[0][0];
    expect(findArg.slackUserId).toBe('U1');
    expect(findArg.deadlineWithinDays).toBe(3);
    expect(deps.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = deps.slackNotifier.postMessage.mock.calls[0][0];
    expect(call.target).toBe('C1');
    expect(call.text).toMatch(/📌 \*지원 넛지 — \d{4}-\d{2}-\d{2}\*/);
    expect(call.text).toContain('토스');
  });

  it('due 0건 — Slack 발송 미호출 (조용히 skip)', async () => {
    const deps = makeConsumer([]);
    await deps.consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as never);

    expect(deps.repository.findDueNudges).toHaveBeenCalledTimes(1);
    expect(deps.slackNotifier.postMessage).not.toHaveBeenCalled();
  });

  it('findDueNudges 실패 — propagate + owner 실패 알람 발사', async () => {
    const deps = makeConsumer([]);
    deps.repository.findDueNudges.mockRejectedValue(new Error('db down'));

    await expect(
      deps.consumer.process({
        data: { ownerSlackUserId: 'U1', target: 'C1' },
      } as never),
    ).rejects.toThrow('db down');
    expect(deps.slackNotifier.postMessage).not.toHaveBeenCalled();
    expect(deps.notificationPublisher.publishCronFailure).toHaveBeenCalledWith({
      cronName: 'Job Application Nudge Cron',
      ownerSlackUserId: 'U1',
      errorMessage: 'db down',
    });
  });
});
