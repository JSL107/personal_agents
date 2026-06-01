import { shouldFireAlert } from './slack-claude-auth-alerter.service';

describe('shouldFireAlert — 30분 dedupe 판정', () => {
  it('첫 호출 (lastFiredAtMs=null) 은 무조건 발사', () => {
    expect(shouldFireAlert({ lastFiredAtMs: null, nowMs: 1_000_000 })).toBe(
      true,
    );
  });

  it('30분 안 (window 미만) 은 dedupe 로 skip', () => {
    const lastFiredAtMs = 1_000_000;
    const nowMs = lastFiredAtMs + 29 * 60 * 1000;
    expect(shouldFireAlert({ lastFiredAtMs, nowMs })).toBe(false);
  });

  it('정확히 30분 경과 시점은 발사 (>=)', () => {
    const lastFiredAtMs = 1_000_000;
    const nowMs = lastFiredAtMs + 30 * 60 * 1000;
    expect(shouldFireAlert({ lastFiredAtMs, nowMs })).toBe(true);
  });

  it('30분 초과는 발사', () => {
    const lastFiredAtMs = 1_000_000;
    const nowMs = lastFiredAtMs + 60 * 60 * 1000;
    expect(shouldFireAlert({ lastFiredAtMs, nowMs })).toBe(true);
  });

  it('custom windowMs 옵션이 적용된다 (테스트 가독성)', () => {
    expect(
      shouldFireAlert({ lastFiredAtMs: 0, nowMs: 5, windowMs: 10 }),
    ).toBe(false);
    expect(
      shouldFireAlert({ lastFiredAtMs: 0, nowMs: 10, windowMs: 10 }),
    ).toBe(true);
  });
});
