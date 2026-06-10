import { Redis } from 'ioredis';

import { CronIdempotencyService } from './cron-idempotency.service';

// CronIdempotencyService — stalled 재처리로 인한 중복 발송 차단.
// "오늘 이미 발송했으면 두 번째는 skip" 하는 idempotency 가드.
//
// 세 가지 시나리오:
//   A) Redis 정상 — SET NX 기반 atomic 가드
//   B) Redis 미주입 — in-memory Set fallback (테스트/단일 노드)
//   C) Redis 장애 — 경고 로그 + in-memory fallback (graceful degradation)

describe('CronIdempotencyService — in-memory fallback (Redis 미주입)', () => {
  let service: CronIdempotencyService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new CronIdempotencyService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('첫 번째 acquireOnce 호출은 true (첫 실행)', async () => {
    const result = await service.acquireOnce(
      'cron:morning-briefing:2026-06-10',
      90_000,
    );
    expect(result).toBe(true);
  });

  it('같은 키 두 번째 acquireOnce 는 false (중복 차단)', async () => {
    await service.acquireOnce('cron:morning-briefing:2026-06-10', 90_000);
    const result = await service.acquireOnce(
      'cron:morning-briefing:2026-06-10',
      90_000,
    );
    expect(result).toBe(false);
  });

  it('다른 날짜 키는 독립 (날짜별 격리)', async () => {
    await service.acquireOnce('cron:morning-briefing:2026-06-10', 90_000);
    const result = await service.acquireOnce(
      'cron:morning-briefing:2026-06-11',
      90_000,
    );
    expect(result).toBe(true);
  });

  it('다른 cron 이름 키도 독립 격리', async () => {
    await service.acquireOnce('cron:morning-briefing:2026-06-10', 90_000);
    const result = await service.acquireOnce(
      'cron:daily-eval:2026-06-10',
      90_000,
    );
    expect(result).toBe(true);
  });

  it('TTL 만료 후 같은 키 재획득 가능 (setTimeout 으로 cleanup)', async () => {
    const ttlSeconds = 10;
    await service.acquireOnce('cron:morning-briefing:2026-06-10', ttlSeconds);
    // TTL 초과 경과
    jest.advanceTimersByTime((ttlSeconds + 1) * 1000);
    const result = await service.acquireOnce(
      'cron:morning-briefing:2026-06-10',
      ttlSeconds,
    );
    expect(result).toBe(true);
  });
});

describe('CronIdempotencyService — Redis 정상 (SET NX atomic)', () => {
  const buildRedisMock = (setResult: 'OK' | null) => {
    const set = jest.fn().mockResolvedValue(setResult);
    const redis = { set } as unknown as Redis;
    return { redis, set };
  };

  it('Redis SET NX 가 OK 반환 → true (첫 실행)', async () => {
    const { redis, set } = buildRedisMock('OK');
    const service = new CronIdempotencyService(redis);

    const result = await service.acquireOnce(
      'cron:morning-briefing:2026-06-10',
      90_000,
    );

    expect(result).toBe(true);
    expect(set).toHaveBeenCalledWith(
      'cron:morning-briefing:2026-06-10',
      '1',
      'EX',
      90_000,
      'NX',
    );
  });

  it('Redis SET NX 가 null 반환 → false (이미 실행됨=중복 차단)', async () => {
    const { redis } = buildRedisMock(null);
    const service = new CronIdempotencyService(redis);

    const result = await service.acquireOnce(
      'cron:morning-briefing:2026-06-10',
      90_000,
    );

    expect(result).toBe(false);
  });
});

describe('CronIdempotencyService — Redis 장애 시 in-memory graceful fallback', () => {
  it('Redis set 이 throw 하면 in-memory fallback 으로 true 반환 (첫 실행)', async () => {
    const set = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const redis = { set } as unknown as Redis;
    const service = new CronIdempotencyService(redis);

    const result = await service.acquireOnce(
      'cron:morning-briefing:2026-06-10',
      90_000,
    );

    expect(result).toBe(true);
  });

  it('Redis 장애 시 연속 호출도 in-memory 로 중복 차단', async () => {
    const set = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const redis = { set } as unknown as Redis;
    const service = new CronIdempotencyService(redis);

    await service.acquireOnce('cron:morning-briefing:2026-06-10', 90_000);
    const second = await service.acquireOnce(
      'cron:morning-briefing:2026-06-10',
      90_000,
    );

    expect(second).toBe(false);
  });
});
