import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { addDays, comparePlainDate, dayOfWeek, PlainDate } from './plain-date';
import { VacationException } from './vacation.exception';
import { VacationErrorCode } from './vacation-error-code.enum';

// 공휴일 제외 확장 훅. 현재는 no-op (주말만 제외). 추후 KR 공휴일 소스 주입.
export interface HolidayProvider {
  isHoliday(date: PlainDate): boolean;
}

export class NoopHolidayProvider implements HolidayProvider {
  isHoliday(): boolean {
    return false;
  }
}

// [start, end] 양끝 포함, 토·일 + 공휴일 제외 영업일 수.
export const countBusinessDays = (
  start: PlainDate,
  end: PlainDate,
  holidays: HolidayProvider = new NoopHolidayProvider(),
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
