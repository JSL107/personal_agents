import { resolveAiWeeklyPeriod, toKstIso } from './ai-weekly-period';

describe('주간 집계 기간', () => {
  it.each(['2026-11-09', '2026-11-10', '2026-11-15'])(
    '%s 기준으로 가장 가까운 월요일부터 직전 주를 구한다',
    (day) => {
      const period = resolveAiWeeklyPeriod(day);
      expect(toKstIso(period.until)).toBe('2026-11-09T00:00:00+09:00');
      expect(toKstIso(period.since)).toBe('2026-11-02T00:00:00+09:00');
      expect(toKstIso(period.prevSince)).toBe('2026-10-26T00:00:00+09:00');
    },
  );
});
