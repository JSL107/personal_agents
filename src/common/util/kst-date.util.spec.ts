import { getTodayKstDate } from './kst-date.util';

describe('getTodayKstDate', () => {
  it('YYYY-MM-DD ISO 8601 형식 반환', () => {
    expect(getTodayKstDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Asia/Seoul timezone 기준 — UTC 와 다른 day 일 수 있음', () => {
    // 본 환경 timezone 무관 — 결과가 KST 기준 오늘. 길이/형식만 검증.
    const result = getTodayKstDate();
    expect(result).toHaveLength(10);
    const [year, month, day] = result.split('-').map(Number);
    expect(year).toBeGreaterThanOrEqual(2026);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});
