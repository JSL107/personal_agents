import { HolidayCalendar } from '../business-calendar';

export interface HolidayCalendarPort {
  // 공휴일 달력을 읽는다. 조회 자체가 실패하면 빈 달력이 아니라 예외를 던진다 — 빈 달력은
  // "휴일이 없다" 로 읽혀 휴장일에 주문 목표일을 잡는다.
  load(): Promise<HolidayCalendar>;
}

export const HOLIDAY_CALENDAR_PORT = Symbol('HOLIDAY_CALENDAR_PORT');
