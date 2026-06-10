import { computeBalance } from './balance-calculator';
import { MonthlyThenFixed15Policy } from './policy/accrual-policy';
import { LeaveUsageRecord } from './vacation.type';

const usage = (
  id: number,
  start: string,
  end: string,
  days: number,
): LeaveUsageRecord => {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return {
    id,
    slackUserId: 'U1',
    startDate: { year: sy, month: sm, day: sd },
    endDate: { year: ey, month: em, day: ed },
    businessDays: days,
    memo: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
};

describe('computeBalance', () => {
  const policy = new MonthlyThenFixed15Policy();
  const hire = { year: 2024, month: 1, day: 15 };
  const asOf = { year: 2026, month: 6, day: 10 }; // 만 2년 → 회기 2026-01-15~2027-01-14, 부여 15

  it('회기 내 사용만 차감 (시작일 기준 귀속)', () => {
    const usages = [
      usage(1, '2026-03-02', '2026-03-06', 5),
      usage(2, '2025-12-01', '2025-12-03', 3),
    ];
    const balance = computeBalance({ hireDate: hire, asOf, policy, usages });
    expect(balance.grantedDays).toBe(15);
    expect(balance.usedDays).toBe(5);
    expect(balance.remainingDays).toBe(10);
    expect(balance.usagesInPeriod.map((u) => u.id)).toEqual([1]);
  });

  it('회기 경계 당일 사용은 포함 (periodStart 당일)', () => {
    const usages = [usage(1, '2026-01-15', '2026-01-15', 1)];
    const balance = computeBalance({ hireDate: hire, asOf, policy, usages });
    expect(balance.usedDays).toBe(1);
  });

  it('사용 없으면 잔여 = 부여', () => {
    const balance = computeBalance({
      hireDate: hire,
      asOf,
      policy,
      usages: [],
    });
    expect(balance.remainingDays).toBe(15);
  });

  it('초과 사용 시 음수 잔여 허용 (경고는 표현 계층 책임)', () => {
    const usages = [usage(1, '2026-02-01', '2026-02-28', 20)];
    const balance = computeBalance({ hireDate: hire, asOf, policy, usages });
    expect(balance.remainingDays).toBe(-5);
  });
});
