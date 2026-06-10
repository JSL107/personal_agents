import {
  LeaveUsageRecord,
  VacationBalance,
} from '../../agent/vacation/domain/vacation.type';
import {
  formatBalance,
  formatCanceled,
  formatRegistered,
  formatUsageList,
} from './vacation.formatter';

const balance: VacationBalance = {
  hireDate: { year: 2024, month: 1, day: 15 },
  asOf: { year: 2026, month: 6, day: 10 },
  periodStart: { year: 2026, month: 1, day: 15 },
  periodEnd: { year: 2027, month: 1, day: 14 },
  grantedDays: 15,
  usedDays: 5,
  remainingDays: 10,
  usagesInPeriod: [],
};

describe('vacation.formatter', () => {
  it('formatBalance 는 부여/사용/잔여 포함', () => {
    const text = formatBalance(balance);
    expect(text).toContain('15');
    expect(text).toContain('10');
    expect(text).toContain('2026-01-15');
  });

  it('초과 사용(음수 잔여)이면 경고 표기', () => {
    const text = formatBalance({ ...balance, usedDays: 20, remainingDays: -5 });
    expect(text).toContain('초과');
  });

  it('formatRegistered 는 등록 영업일 + 잔여', () => {
    const registered: LeaveUsageRecord = {
      id: 10,
      slackUserId: 'U1',
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 3 },
      businessDays: 3,
      memo: null,
      createdAt: new Date(),
    };
    const text = formatRegistered({ registered, balance });
    expect(text).toContain('2026-07-01');
    expect(text).toContain('3');
    // 등록 완료에 번호(#id) + 취소 안내 노출 (바로 취소 가능)
    expect(text).toContain('#10');
    expect(text).toContain('/휴가 취소 10');
  });

  it('formatUsageList 빈 내역 안내', () => {
    expect(formatUsageList([])).toContain('없');
  });

  it('formatCanceled 는 취소 id 포함', () => {
    expect(formatCanceled({ canceledId: 10, balance })).toContain('10');
  });
});
