import {
  axisForWeek,
  lastCompletedWindowEnd,
  weekStartOf,
} from './tune-schedule';

describe('tune-schedule', () => {
  it('weekStartOf: 날짜가 속한 주의 월요일을 돌려준다', () => {
    expect(weekStartOf('2026-11-21')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16');
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16');
    expect(weekStartOf('2027-01-02')).toBe('2026-12-28');
  });

  it('axisForWeek: 기준 주부터 4주 주기로 회전한다', () => {
    expect(axisForWeek('2026-11-16')).toBe('EXIT_TAKE_PROFIT_PERCENT');
    expect(axisForWeek('2026-11-23')).toBe('EXIT_STOP_LOSS_PERCENT');
    expect(axisForWeek('2026-12-14')).toBe('EXIT_TAKE_PROFIT_PERCENT');
    expect(axisForWeek('2026-12-28')).not.toBe(axisForWeek('2027-01-04'));
  });

  it('axisForWeek: 기준 주 이전에도 음수 없이 회전한다', () => {
    expect(axisForWeek('2026-11-09')).toBe('MAXIMUM_WEIGHT_PERCENT');
  });

  it('lastCompletedWindowEnd: 끝난 창만 센다', () => {
    expect(lastCompletedWindowEnd('2026-11-21')).toBe('2026-09-30');
    expect(lastCompletedWindowEnd('2026-09-30')).toBe('2026-03-31');
    expect(lastCompletedWindowEnd('2026-10-01')).toBe('2026-09-30');
  });
});
