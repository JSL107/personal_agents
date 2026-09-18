import {
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../schedule/domain/schedule.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const DAY_MS = 24 * 60 * 60 * 1000;

// `today` 는 **KST 달력일의 UTC 자정** 이어야 한다. `dueDate` 가 `@db.Date` 라 같은 표현이고,
// 그래야 두 값의 차이가 정확히 일수의 정수배가 된다. 시각이 붙은 `new Date()` 를 그대로 넣으면
// 반올림이 어긋나 밤에는 내일 마감이 `D-day` 로 찍힌다(2026-09-18 실측).
const toDayLabel = (dueDate: Date, today: Date): string => {
  const remaining = Math.round((dueDate.getTime() - today.getTime()) / DAY_MS);
  if (remaining === 0) {
    return 'D-day';
  }
  if (remaining < 0) {
    return `D+${Math.abs(remaining)}`;
  }
  return `D-${remaining}`;
};

export const formatUpcomingLine = (
  items: ScheduleItemRecord[],
  today: Date,
): string => {
  const open = items.filter((item) => item.status === ScheduleStatus.OPEN);
  if (open.length === 0) {
    return '';
  }
  const parts = open.map((item) => {
    // 제목은 사용자가 친 원문이다. `<`·`>`·`&` 를 막지 않으면 Slack 이 `<...>` 를 링크 태그로
    // 읽어 텍스트가 사라진다 — `schedule.formatter.ts` 와 같은 처리다.
    return `${escapeSlackMrkdwn(item.title)}(${toDayLabel(item.dueDate, today)})`;
  });
  return `\n📌 다가오는 마감 — ${parts.join(' · ')}`;
};
