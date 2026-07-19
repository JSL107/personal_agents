import { hasWoken, SystemWakeGuard } from './system-wake-guard.service';

// now() 를 제어하기 위한 테스트 서브클래스 — heartbeat drift(절전) 판정을 결정론적으로 검증한다.
class TestableWakeGuard extends SystemWakeGuard {
  public fakeNow = 1_000_000;
  protected now(): number {
    return this.fakeNow;
  }
}

describe('hasWoken (순수 함수)', () => {
  it('elapsed 가 threshold 를 초과하면 true', () => {
    expect(hasWoken(120_001, 120_000)).toBe(true);
    expect(hasWoken(642_000, 120_000)).toBe(true);
  });

  it('elapsed 가 threshold 이하이면 false', () => {
    expect(hasWoken(120_000, 120_000)).toBe(false);
    expect(hasWoken(60_000, 120_000)).toBe(false);
    expect(hasWoken(0, 120_000)).toBe(false);
  });
});

describe('SystemWakeGuard.justWoke', () => {
  it('heartbeat drift 가 임계 이하이면 false(평상시)', () => {
    const guard = new TestableWakeGuard();
    guard.onModuleInit();
    guard.fakeNow += 60_000; // 60s — 임계(120s) 이하
    expect(guard.justWoke()).toBe(false);
    guard.onModuleDestroy();
  });

  it('heartbeat drift 가 임계를 초과하면 true(절전에서 깸)', () => {
    const guard = new TestableWakeGuard();
    guard.onModuleInit();
    guard.fakeNow += 642_000; // 642s — 실제 장애 로그의 tick 간격
    expect(guard.justWoke()).toBe(true);
    guard.onModuleDestroy();
  });
});

describe('SystemWakeGuard.waitUntilReady', () => {
  it('절전이 아니면 대기 없이 즉시 ready, probe 는 호출하지 않는다', async () => {
    const guard = new SystemWakeGuard();
    jest.spyOn(guard, 'justWoke').mockReturnValue(false);
    const probe = jest.fn().mockResolvedValue(true);

    const result = await guard.waitUntilReady(probe);

    expect(result).toEqual({ waited: false, ready: true, attempts: 0 });
    expect(probe).not.toHaveBeenCalled();
  });

  it('절전 감지 시 probe 가 성공할 때까지 폴링한다', async () => {
    const guard = new SystemWakeGuard();
    jest.spyOn(guard, 'justWoke').mockReturnValue(true);
    const probe = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const result = await guard.waitUntilReady(probe, {
      intervalMs: 1,
      maxWaitMs: 5_000,
    });

    expect(result.waited).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('절전 감지 + probe 가 계속 실패하면 타임아웃 후 그대로 진행(ready=false)', async () => {
    const guard = new SystemWakeGuard();
    jest.spyOn(guard, 'justWoke').mockReturnValue(true);
    const probe = jest.fn().mockResolvedValue(false);

    const result = await guard.waitUntilReady(probe, {
      intervalMs: 1,
      maxWaitMs: 15,
    });

    expect(result.waited).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  it('probe 가 예외를 던지면 미준비로 처리하고 폴링을 계속한다', async () => {
    const guard = new SystemWakeGuard();
    jest.spyOn(guard, 'justWoke').mockReturnValue(true);
    const probe = jest
      .fn()
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValue(true);

    const result = await guard.waitUntilReady(probe, {
      intervalMs: 1,
      maxWaitMs: 5_000,
    });

    expect(result.ready).toBe(true);
    expect(result.attempts).toBe(2);
  });
});
