import { ConfigService } from '@nestjs/config';

import { MonthlyThenFixed15Policy } from '../domain/policy/accrual-policy';

// 선지급 설정(VACATION_FIRST_YEAR_ADVANCE_DAYS)을 반영한 발생 정책. 잔여·등록·취소가 모두
// 이 한 곳을 지나므로 슬래시와 자연어 응답의 부여 일수가 갈리지 않는다.
export const resolveAccrualPolicy = (
  config: ConfigService,
): MonthlyThenFixed15Policy => {
  return new MonthlyThenFixed15Policy(
    config.get<number>('VACATION_FIRST_YEAR_ADVANCE_DAYS'),
  );
};
