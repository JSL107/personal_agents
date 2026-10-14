import {
  addDays,
  PlainDate,
  plainDateToUtcDate,
  utcDateToPlainDate,
} from '../../agent/vacation/domain/plain-date';
import {
  HolidayCalendar,
  isPublicBusinessDay,
} from '../../holiday/domain/business-calendar';

// 기준일은 포함하지 않는다. KRX 연말 휴장일은 일반 일정의 휴일이 아니다.
export const addPublicBusinessDays = (
  from: PlainDate | Date,
  businessDays: number,
  calendar: HolidayCalendar,
): PlainDate => {
  if (!Number.isInteger(businessDays) || businessDays < 1) {
    throw new RangeError('businessDays 는 1 이상의 정수여야 합니다.');
  }
  let cursor = from instanceof Date ? utcDateToPlainDate(from) : from;
  let count = 0;
  while (count < businessDays) {
    cursor = addDays(cursor, 1);
    if (isPublicBusinessDay(plainDateToUtcDate(cursor), calendar)) {
      count += 1;
    }
  }
  return cursor;
};
