import {
  addDays,
  addYears,
  monthsElapsed,
  PlainDate,
  yearsElapsed,
} from '../plain-date';

export interface AccrualResult {
  grantedDays: number;
  periodStart: PlainDate;
  periodEnd: PlainDate;
}

// 발생 규칙을 교체 가능한 전략으로 추상화 (확장: 근로기준법 가산 등).
export interface AccrualPolicy {
  accrualFor(hireDate: PlainDate, asOf: PlainDate): AccrualResult;
}

// 1년 미만: 만 1개월당 1일 (최대 11). 1년 이상: 매년 15일 고정(가산 없음).
export class MonthlyThenFixed15Policy implements AccrualPolicy {
  accrualFor(hireDate: PlainDate, asOf: PlainDate): AccrualResult {
    const years = yearsElapsed(hireDate, asOf);

    if (years < 1) {
      const months = monthsElapsed(hireDate, asOf);
      return {
        grantedDays: Math.min(months, 11),
        periodStart: hireDate,
        periodEnd: addDays(addYears(hireDate, 1), -1),
      };
    }

    return {
      grantedDays: 15,
      periodStart: addYears(hireDate, years),
      periodEnd: addDays(addYears(hireDate, years + 1), -1),
    };
  }
}
