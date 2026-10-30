import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  cancelCatchUpsDueSoon,
  enqueueMissedRuns,
  MISSED_RUN_MIN_GAP_MS,
  readNonEmptyConfig,
  removeAllRepeatables,
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
  remove: jest.fn().mockResolvedValue(1),
});

const makeLogger = () =>
  ({ log: jest.fn(), warn: jest.fn() }) as unknown as Logger;

describe('enqueueMissedRuns', () => {
  it('지나간 대기 회차를 그 job 의 data·재시도 옵션 그대로 한 번 넣는다', async () => {
    const missedAt = NOW - 60 * 60_000;
    const queue = makeQueue([
      { key: 'k1', name: 'daily', next: missedAt },
      { key: 'k2', name: 'future', next: NOW + 60_000 },
      { key: 'k3', name: 'unknown' },
    ]);

    const catchUps = await enqueueMissedRuns(queue as never, makeLogger(), {
      now: NOW,
    });

    expect(queue.getJob).toHaveBeenCalledWith(`repeat:k1:${missedAt}`);
    expect(queue.add).toHaveBeenCalledTimes(1);
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
    expect([...catchUps]).toEqual([['daily', `catchup-daily-${missedAt}`]]);
  });

  it('제외 대상은 넣지 않는다', async () => {
    const queue = makeQueue([{ key: 'k1', name: 'paper', next: NOW - 1 }]);

    const catchUps = await enqueueMissedRuns(queue as never, makeLogger(), {
      now: NOW,
      shouldCatchUp: (name) => name !== 'paper',
    });

    expect(queue.add).not.toHaveBeenCalled();
    expect(catchUps.size).toBe(0);
  });

  it('대기 job 을 못 찾으면 경고만 남기고 넣지 않는다', async () => {
    const queue = makeQueue([{ key: 'k1', name: 'daily', next: NOW - 1 }]);
    queue.getJob.mockResolvedValueOnce(undefined as never);
    const logger = makeLogger();

    await enqueueMissedRuns(queue as never, logger, { now: NOW });

    expect(queue.add).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('add 가 실패하면 그대로 던진다 — repeatable 을 지우기 전이라 다음 부팅이 다시 찾는다', async () => {
    const queue = makeQueue([{ key: 'k1', name: 'daily', next: NOW - 1 }]);
    queue.add.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      enqueueMissedRuns(queue as never, makeLogger(), { now: NOW }),
    ).rejects.toThrow('redis down');
  });
});

describe('cancelCatchUpsDueSoon', () => {
  it('다음 정기 회차가 1시간 안이면 보충을 취소한다 — 고빈도 주기는 곧 다시 돈다', async () => {
    const queue = makeQueue([
      { key: 'k1', name: 'sweep', next: NOW + MISSED_RUN_MIN_GAP_MS },
      { key: 'k2', name: 'daily', next: NOW + DAY },
    ]);

    await cancelCatchUpsDueSoon(
      queue as never,
      new Map([
        ['sweep', 'catchup-sweep-1'],
        ['daily', 'catchup-daily-1'],
      ]),
      makeLogger(),
      NOW,
    );

    expect(queue.remove).toHaveBeenCalledTimes(1);
    expect(queue.remove).toHaveBeenCalledWith('catchup-sweep-1');
  });

  it('보충이 없으면 큐를 읽지도 않는다', async () => {
    const queue = makeQueue([]);

    await cancelCatchUpsDueSoon(queue as never, new Map(), makeLogger(), NOW);

    expect(queue.getRepeatableJobs).not.toHaveBeenCalled();
  });

  it('취소에 실패해도 던지지 않는다 — 부팅을 막지 않는다', async () => {
    const queue = makeQueue([{ key: 'k1', name: 'sweep', next: NOW + 1 }]);
    queue.remove.mockRejectedValueOnce(new Error('locked'));
    const logger = makeLogger();

    await cancelCatchUpsDueSoon(
      queue as never,
      new Map([['sweep', 'catchup-sweep-1']]),
      logger,
      NOW,
    );

    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('removeAllRepeatables', () => {
  it('등록된 모든 반복 작업을 키 순서대로 제거한다', async () => {
    const queue = {
      getRepeatableJobs: jest
        .fn()
        .mockResolvedValue([{ key: 'k1' }, { key: 'k2' }]),
      removeRepeatableByKey: jest.fn().mockResolvedValue(true),
    };

    await removeAllRepeatables(queue as never);

    expect(queue.removeRepeatableByKey.mock.calls).toEqual([['k1'], ['k2']]);
  });
});

describe('readNonEmptyConfig', () => {
  it.each([undefined, '', '   '])(
    '설정값이 %p 이면 기본값을 반환한다',
    (value) => {
      const configService = {
        get: jest.fn().mockReturnValue(value),
      } as unknown as ConfigService;

      expect(
        readNonEmptyConfig({ configService, key: 'KEY', fallback: 'default' }),
      ).toBe('default');
      expect(configService.get).toHaveBeenCalledWith('KEY');
    },
  );

  it('설정값이 있으면 앞뒤 공백을 제거해 반환한다', () => {
    const configService = {
      get: jest.fn().mockReturnValue('  value  '),
    } as unknown as ConfigService;

    expect(
      readNonEmptyConfig({ configService, key: 'KEY', fallback: 'default' }),
    ).toBe('value');
  });
});
