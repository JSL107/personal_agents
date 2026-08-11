import {
  formatKstDate,
  getKstDayStartAsUtc,
  getTodayKstDate,
} from './kst-date.util';

describe('formatKstDate', () => {
  it('UTC 16시는 KST 자정 이후이므로 다음 KST 날짜를 반환한다', () => {
    expect(formatKstDate('2026-08-10T16:00:00Z')).toBe('2026-08-11');
  });

  it('UTC 14:59:59는 KST 자정 전이므로 같은 KST 날짜를 반환한다', () => {
    expect(formatKstDate('2026-08-10T14:59:59Z')).toBe('2026-08-10');
  });

  it('파싱할 수 없는 입력은 null을 반환한다', () => {
    expect(formatKstDate('not-a-date')).toBeNull();
  });
});

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

describe('getKstDayStartAsUtc', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T16:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('daysAgo=0 이면 오늘 KST 00:00 을 UTC instant 로 반환한다', () => {
    const result = getKstDayStartAsUtc(0);

    expect(result.toISOString()).toBe('2026-07-07T15:00:00.000Z');
  });

  it('daysAgo=6 이면 6일 전 KST 00:00 을 UTC instant 로 반환한다', () => {
    const result = getKstDayStartAsUtc(6);

    expect(result.toISOString()).toBe('2026-07-01T15:00:00.000Z');
  });
});
