import { shouldFireCronAlert } from './slack-cron-failure-alerter.service';

describe('shouldFireCronAlert — cron 별 30분 dedupe', () => {
  it('lastFiredAtMs=null 이면 첫 발사 OK', () => {
    expect(shouldFireCronAlert({ lastFiredAtMs: null, nowMs: 0 })).toBe(true);
  });

  it('동일 cron 의 dedupe window 내 (30분 미만) 추가 발사 X', () => {
    const t0 = 1_700_000_000_000;
    expect(
      shouldFireCronAlert({
        lastFiredAtMs: t0,
        nowMs: t0 + 29 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it('동일 cron 의 dedupe window 경과 (정확히 30분) 후 발사 OK', () => {
    const t0 = 1_700_000_000_000;
    expect(
      shouldFireCronAlert({
        lastFiredAtMs: t0,
        nowMs: t0 + 30 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it('windowMs 옵션으로 dedupe 폭 override 가능 (spec / 단위 테스트 용)', () => {
    const t0 = 1_700_000_000_000;
    expect(
      shouldFireCronAlert({
        lastFiredAtMs: t0,
        nowMs: t0 + 1000,
        windowMs: 500,
      }),
    ).toBe(true);
    expect(
      shouldFireCronAlert({
        lastFiredAtMs: t0,
        nowMs: t0 + 100,
        windowMs: 500,
      }),
    ).toBe(false);
  });
});
