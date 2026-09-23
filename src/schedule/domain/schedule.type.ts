export enum ScheduleStatus {
  OPEN = 'OPEN',
  DONE = 'DONE',
  SKIPPED = 'SKIPPED',
}

// 날짜만 다루는 값. JS Date 는 2월 30일 같은 없는 날짜를 조용히 다음 달로 넘기므로
// 파서가 만든 값을 그대로 신뢰하지 않고 이 형태로 고정해 옮긴다.
export interface PlainDate {
  year: number;
  month: number;
  day: number;
}

export interface ScheduleItemRecord {
  id: number;
  slackUserId: string;
  title: string;
  dueDate: Date;
  dueTime: string | null;
  linkUrl: string | null;
  memo: string | null;
  status: ScheduleStatus;
  completedAt: Date | null;
  // 공휴일 동기화가 넣은 행인가. 콘솔 달력의 색과 아침 브리핑의 제외가 이 값 하나를 본다
  // (`schedule-briefing.formatter.ts`, `CalendarView.swift`).
  isHoliday: boolean;
}

// 상태 전이 규칙. 완료를 되돌릴 수 있어야 오조작이 영구 기록으로 남지 않는다.
// 같은 상태로의 전이만 막는다 — 멱등해 보이지만 completedAt 을 덮어써 기록이 흐려진다.
export const canTransition = (
  from: ScheduleStatus,
  to: ScheduleStatus,
): boolean => {
  return from !== to;
};
