import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { addDays, comparePlainDate, dayOfWeek, PlainDate } from './plain-date';
import { VacationException } from './vacation.exception';
import { VacationErrorCode } from './vacation-error-code.enum';

// 공휴일 판정. 운영 경로는 `register-leave.usecase.ts` 가 공휴일 달력(`holiday-sync`)을 넣는다.
export interface HolidayProvider {
  isHoliday(date: PlainDate): boolean;
}

// 공휴일을 모르는 판정. 주말만 다루는 테스트용이다. `countBusinessDays` 의 기본값으로 두지
// 않는다 — 기본값이 있으면 호출부가 달력을 빠뜨려도 조용히 공휴일까지 휴가 일수로 센다.
export class NoopHolidayProvider implements HolidayProvider {
  isHoliday(): boolean {
    return false;
  }
}

// [start, end] 양끝 포함, 토·일 + 공휴일 제외 영업일 수.
export const countBusinessDays = (
  start: PlainDate,
  end: PlainDate,
  holidays: HolidayProvider,
): number => {
  if (comparePlainDate(start, end) > 0) {
    throw new VacationException({
      code: VacationErrorCode.INVALID_DATE_RANGE,
      message: `시작일이 종료일보다 늦습니다 (${start.year}-${start.month}-${start.day} > ${end.year}-${end.month}-${end.day}).`,
      status: DomainStatus.BAD_REQUEST,
    });
  }
  let count = 0;
  let cursor = start;
  while (comparePlainDate(cursor, end) <= 0) {
    const dow = dayOfWeek(cursor);
    const isWeekend = dow === 0 || dow === 6;
    if (!isWeekend && !holidays.isHoliday(cursor)) {
      count += 1;
    }
    cursor = addDays(cursor, 1);
  }
  return count;
};
