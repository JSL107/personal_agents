import { MonthlyThenFixed15Policy } from './accrual-policy';

describe('MonthlyThenFixed15Policy', () => {
  const policy = new MonthlyThenFixed15Policy();
  const hire = { year: 2024, month: 1, day: 15 };

  it('입사 당일 = 0일, 회기 [입사일, +1년-1일]', () => {
    expect(policy.accrualFor(hire, { year: 2024, month: 1, day: 15 })).toEqual({
      grantedDays: 0,
      periodStart: { year: 2024, month: 1, day: 15 },
      periodEnd: { year: 2025, month: 1, day: 14 },
    });
  });

  it('만 1개월 = 1일', () => {
    expect(
      policy.accrualFor(hire, { year: 2024, month: 2, day: 15 }).grantedDays,
    ).toBe(1);
  });

  it('만 11개월 = 11일', () => {
    expect(
      policy.accrualFor(hire, { year: 2024, month: 12, day: 15 }).grantedDays,
    ).toBe(11);
  });

  it('만 11개월 초과(만 11.x개월)도 최대 11일 캡', () => {
    expect(
      policy.accrualFor(hire, { year: 2024, month: 12, day: 31 }).grantedDays,
    ).toBe(11);
  });

  it('만 1년 당일 = 15일, 회기 [+1년, +2년-1일]', () => {
    expect(policy.accrualFor(hire, { year: 2025, month: 1, day: 15 })).toEqual({
      grantedDays: 15,
      periodStart: { year: 2025, month: 1, day: 15 },
      periodEnd: { year: 2026, month: 1, day: 14 },
    });
  });

  it('만 1년 직전 = 11일 (아직 1년 미만 구간)', () => {
    expect(
      policy.accrualFor(hire, { year: 2025, month: 1, day: 14 }).grantedDays,
    ).toBe(11);
  });

  it('만 2년 = 15일 고정(가산 없음), 회기 [+2년, +3년-1일]', () => {
    expect(policy.accrualFor(hire, { year: 2026, month: 6, day: 10 })).toEqual({
      grantedDays: 15,
      periodStart: { year: 2026, month: 1, day: 15 },
      periodEnd: { year: 2027, month: 1, day: 14 },
    });
  });

  it('만 5년도 15일 고정', () => {
    expect(
      policy.accrualFor(hire, { year: 2029, month: 3, day: 1 }).grantedDays,
    ).toBe(15);
  });

  it('윤년 입사(2024-02-29) 의 2025-02-28 은 만 1년 회기 시작 (gap 없음)', () => {
    const result = new MonthlyThenFixed15Policy().accrualFor(
      { year: 2024, month: 2, day: 29 },
      { year: 2025, month: 2, day: 28 },
    );
    expect(result.grantedDays).toBe(15);
    expect(result.periodStart).toEqual({ year: 2025, month: 2, day: 28 });
  });
  it('말일 입사(2024-01-31) 만 1개월(2024-02-29) = 1일', () => {
    expect(
      new MonthlyThenFixed15Policy().accrualFor(
        { year: 2024, month: 1, day: 31 },
        { year: 2024, month: 2, day: 29 },
      ).grantedDays,
    ).toBe(1);
  });
});
