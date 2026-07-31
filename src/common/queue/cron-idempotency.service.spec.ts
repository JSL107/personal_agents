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

// release — 획득한 가드 키를 롤백한다. 발송 실패 시 BullMQ 재시도가 같은 슬롯을
// 다시 발송할 수 있도록 "발송 성공 시에만 가드가 소비되게" 만드는 핵심 연산.
describe('CronIdempotencyService — release (가드 롤백)', () => {
  it('in-memory: release 후 같은 키를 재획득할 수 있다', async () => {
    const service = new CronIdempotencyService();
    await service.acquireOnce('cron:evening:2026-06-10', 90_000);

    await service.release('cron:evening:2026-06-10');

    const result = await service.acquireOnce('cron:evening:2026-06-10', 90_000);
    expect(result).toBe(true);
  });

  it('Redis: release 는 DEL 을 호출한다', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const del = jest.fn().mockResolvedValue(1);
    const redis = { set, del } as unknown as Redis;
    const service = new CronIdempotencyService(redis);
    await service.acquireOnce('cron:evening:2026-06-10', 90_000);

    await service.release('cron:evening:2026-06-10');

    expect(del).toHaveBeenCalledWith('cron:evening:2026-06-10');
  });

  it('Redis del 이 throw 해도 swallow (재시도 흐름 보호)', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const del = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const redis = { set, del } as unknown as Redis;
    const service = new CronIdempotencyService(redis);
    await service.acquireOnce('cron:evening:2026-06-10', 90_000);

    await expect(
      service.release('cron:evening:2026-06-10'),
    ).resolves.toBeUndefined();
  });
});

// isDone 은 "무거운 작업(LLM) 앞에서 완주 여부만 묻는" 읽기 전용 확인이다.
// 키를 만들지 않는 것이 핵심 — 진입 시점에 키를 만들면 실행 중 강제 종료 시 그 슬롯이
// TTL 동안 영구 차단된다.
describe('CronIdempotencyService — isDone (읽기 전용 완주 확인)', () => {
  it('in-memory: 획득 전엔 false, 획득 후엔 true', async () => {
    const service = new CronIdempotencyService();
    const key = 'autopilot:morning:2026-07-26';

    expect(await service.isDone(key)).toBe(false);
    await service.acquireOnce(key, 90_000);
    expect(await service.isDone(key)).toBe(true);
  });

  it('in-memory: isDone 은 키를 만들지 않는다 (이후 acquireOnce 가 여전히 첫 실행)', async () => {
    const service = new CronIdempotencyService();
    const key = 'autopilot:morning:2026-07-26';

    await service.isDone(key);

    expect(await service.acquireOnce(key, 90_000)).toBe(true);
  });

  it('Redis: EXISTS 가 1 이면 true, 0 이면 false', async () => {
    const exists = jest.fn().mockResolvedValue(1);
    const service = new CronIdempotencyService({ exists } as unknown as Redis);

    expect(await service.isDone('autopilot:morning:2026-07-26')).toBe(true);
    expect(exists).toHaveBeenCalledWith('autopilot:morning:2026-07-26');

    exists.mockResolvedValue(0);
    expect(await service.isDone('autopilot:morning:2026-07-26')).toBe(false);
  });

  it('Redis exists 가 throw 하면 in-memory 조회로 fallback (throw 하지 않음)', async () => {
    const exists = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new CronIdempotencyService({ exists } as unknown as Redis);

    await expect(service.isDone('autopilot:morning:2026-07-26')).resolves.toBe(
      false,
    );
  });
});
