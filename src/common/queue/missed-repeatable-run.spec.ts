import { Logger } from '@nestjs/common';

import {
  enqueueMissedRuns,
  MISSED_RUN_MIN_GAP_MS,
  snapshotMissedRuns,
} from './missed-repeatable-run';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

type Repeatable = { key: string; name: string; next?: number };

const makeQueue = (repeatables: Repeatable[]) => ({
  getRepeatableJobs: jest.fn().mockResolvedValue(repeatables),
  getJob: jest.fn(async (id: string) => ({
    id,
    data: { owner: 'U1' },
    opts: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
  })),
  add: jest.fn().mockResolvedValue(undefined),
});

const logger = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;

describe('snapshotMissedRuns', () => {
  it('대기 회차 시각이 지난 repeatable 만 이름별로 모은다', async () => {
    const queue = makeQueue([
      { key: 'a', name: 'daily', next: NOW - 60_000 },
      { key: 'b', name: 'future', next: NOW + 60_000 },
      { key: 'c', name: 'unknown' },
    ]);

    const missed = await snapshotMissedRuns(queue as never, NOW);

    expect([...missed]).toEqual([['daily', NOW - 60_000]]);
  });
});

describe('enqueueMissedRuns', () => {
  it('놓친 회차를 대기 job 의 data·재시도 옵션 그대로 한 번 넣는다', async () => {
    const missedAt = NOW - 60 * 60_000;
    const queue = makeQueue([{ key: 'k1', name: 'daily', next: NOW + DAY }]);

    await enqueueMissedRuns(
      queue as never,
      new Map([['daily', missedAt]]),
      logger,
      {
        now: NOW,
      },
    );

    expect(queue.getJob).toHaveBeenCalledWith(`repeat:k1:${NOW + DAY}`);
    expect(queue.add).toHaveBeenCalledWith(
      'daily',
      { owner: 'U1' },
      expect.objectContaining({
        jobId: `catchup-daily-${missedAt}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
      }),
    );
    expect(queue.add.mock.calls[0][2]).not.toHaveProperty('repeat');
  });

  it('다음 정기 회차가 1시간 안이면 보충하지 않는다 — 고빈도 주기는 곧 다시 돈다', async () => {
    const queue = makeQueue([
      { key: 'k1', name: 'sweep', next: NOW + MISSED_RUN_MIN_GAP_MS },
    ]);

    await enqueueMissedRuns(
      queue as never,
      new Map([['sweep', NOW - 1]]),
      logger,
      {
        now: NOW,
      },
    );

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('제외 대상은 보충하지 않는다', async () => {
    const queue = makeQueue([{ key: 'k1', name: 'paper', next: NOW + DAY }]);

    await enqueueMissedRuns(
      queue as never,
      new Map([['paper', NOW - 1]]),
      logger,
      {
        now: NOW,
        shouldCatchUp: (name) => name !== 'paper',
      },
    );

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('놓친 회차가 없으면 큐를 다시 읽지도 않는다', async () => {
    const queue = makeQueue([]);

    await enqueueMissedRuns(queue as never, new Map(), logger);

    expect(queue.getRepeatableJobs).not.toHaveBeenCalled();
  });

  it('대기 job 을 못 찾으면 경고만 남기고 넣지 않는다', async () => {
    const queue = makeQueue([{ key: 'k1', name: 'daily', next: NOW + DAY }]);
    queue.getJob.mockResolvedValueOnce(undefined as never);

    await enqueueMissedRuns(
      queue as never,
      new Map([['daily', NOW - 1]]),
      logger,
      {
        now: NOW,
      },
    );

    expect(queue.add).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
