import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  HolidayCalendar,
  holidayCalendarOf,
} from '../domain/business-calendar';
import { HolidayCalendarPort } from '../domain/port/holiday-calendar.port';

const logger = new Logger('HolidayCalendar');

type HolidayCalendarClient = Pick<Prisma.TransactionClient, 'scheduleItem'>;

// `holiday-sync` 가 넣은 공휴일 행(`schedule_item.is_holiday`)을 달력으로 읽는다.
// 상태(완료·건너뜀)와 소유자는 보지 않는다 — 사용자가 달력에서 공휴일 칩을 완료 처리했다고
// 그 날 장이 열리지는 않는다.
//
// 결제일 계산처럼 트랜잭션 안에서 불리는 곳이 있어 클라이언트를 인자로 받는다. 읽는 규칙이
// 두 벌로 갈리지 않게 포트 구현(`HolidayCalendarPrismaReader`)도 이 함수를 그대로 쓴다.
export const readHolidayCalendar = async (
  client: HolidayCalendarClient,
): Promise<HolidayCalendar> => {
  const rows = await client.scheduleItem.findMany({
    where: { isHoliday: true },
    select: { dueDate: true },
  });
  const dates = rows.map((row) => row.dueDate.toISOString().slice(0, 10));
  warnMissingYears(dates);
  return holidayCalendarOf(dates);
};

// 공휴일이 하나도 없는 해는 없다(1월 1일). 그런 해가 보이면 동기화가 안 된 것이고, 달력은
// 주말만 쉬는 근사로 돈다 — 휴장일에 목표일이 잡히므로 조용히 넘기지 않는다.
// 12월에는 다음 해도 본다. 연말 뒤 첫 거래일이 다음 해 신정 너머로 잡혀야 해서다.
const warnMissingYears = (dates: string[]): void => {
  const today = getTodayKstDate();
  const thisYear = Number(today.slice(0, 4));
  const requiredYears =
    today.slice(5, 7) === '12' ? [thisYear, thisYear + 1] : [thisYear];
  const missingYears = requiredYears.filter(
    (year) => !dates.some((dateText) => dateText.startsWith(`${year}-`)),
  );
  if (missingYears.length > 0) {
    logger.warn(
      `공휴일 데이터가 없는 연도(${missingYears.join(', ')}) — 그 해는 주말만 휴장으로 봅니다. ` +
        'holiday-sync 작업과 KOREAN_HOLIDAY_API_KEY 를 확인하세요.',
    );
  }
};

@Injectable()
export class HolidayCalendarPrismaReader implements HolidayCalendarPort {
  constructor(private readonly prisma: PrismaService) {}

  async load(): Promise<HolidayCalendar> {
    return await readHolidayCalendar(this.prisma);
  }
}
