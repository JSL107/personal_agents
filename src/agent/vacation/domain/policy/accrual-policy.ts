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
// firstYearAdvanceDays: 회사가 1년차 연차를 입사 때 선지급한 경우의 일수. 주어지면 1년차 부여를
// 이 값으로 고정한다 — 이후 월 발생분은 더하지 않고, 2년차 15일에서 차감하지도 않는다.
export class MonthlyThenFixed15Policy implements AccrualPolicy {
  constructor(private readonly firstYearAdvanceDays?: number) {}

  accrualFor(hireDate: PlainDate, asOf: PlainDate): AccrualResult {
    const years = yearsElapsed(hireDate, asOf);

    if (years < 1) {
      const months = monthsElapsed(hireDate, asOf);
      return {
        grantedDays: this.firstYearAdvanceDays ?? Math.min(months, 11),
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
