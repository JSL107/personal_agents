import { comparePlainDate, PlainDate } from './plain-date';
import { AccrualPolicy } from './policy/accrual-policy';
import { LeaveUsageRecord, VacationBalance } from './vacation.type';

interface ComputeBalanceInput {
  hireDate: PlainDate;
  asOf: PlainDate;
  policy: AccrualPolicy;
  usages: LeaveUsageRecord[];
}

// startDate 가 [periodStart, periodEnd] 안에 있으면 현재 회기 귀속.
const isInPeriod = (
  usage: LeaveUsageRecord,
  periodStart: PlainDate,
  periodEnd: PlainDate,
): boolean => {
  return (
    comparePlainDate(usage.startDate, periodStart) >= 0 &&
    comparePlainDate(usage.startDate, periodEnd) <= 0
  );
};

export const computeBalance = ({
  hireDate,
  asOf,
  policy,
  usages,
}: ComputeBalanceInput): VacationBalance => {
  const { grantedDays, periodStart, periodEnd } = policy.accrualFor(
    hireDate,
    asOf,
  );
  const usagesInPeriod = usages.filter((usage) =>
    isInPeriod(usage, periodStart, periodEnd),
  );
  const usedDays = usagesInPeriod.reduce(
    (sum, usage) => sum + usage.businessDays,
    0,
  );
  return {
    hireDate,
    asOf,
    periodStart,
    periodEnd,
    grantedDays,
    usedDays,
    remainingDays: grantedDays - usedDays,
    usagesInPeriod,
  };
};
