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
  // 공휴일은 여기서만 뺀다. 아무도 「완료」를 누르지 않아 영원히 `OPEN` 으로 남는데, 이 줄은
  // 하한 없이 지난 미완까지 전부 싣는 것이 목적이라(`morning-briefing.autopilot-task.ts` 가
  // `from` 을 넘기지 않는다) 거르지 않으면 해가 갈수록 `신정(D+265) · 설날(D+240) · …` 이
  // 끝없이 쌓인다. 달력에서는 그대로 보이고 완료·건너뜀도 된다 — 브리핑 한 줄에서만 뺀다.
  const open = items.filter(
    (item) => item.status === ScheduleStatus.OPEN && !item.isHoliday,
  );
  if (open.length === 0) {
    return '';
  }
  const parts = open.map((item) => {
    // 제목은 사용자가 친 원문이다. `<`·`>`·`&` 를 막지 않으면 Slack 이 `<...>` 를 링크 태그로
    // 읽어 텍스트가 사라진다 — `schedule.formatter.ts` 와 같은 처리다.
    return `${escapeSlackMrkdwn(item.title)}(${toDayLabel(item.dueDate, today)})`;
  });
  // 머리글은 **「다가오는」 이 아니라 「마감」** 이다. 조회에 하한이 없어 기한이 지난 미완
  // 항목(`D+n`)이 같은 줄에 섞이므로, "다가오는" 이라고 쓰면 줄의 절반이 거짓이 된다.
  // 놓친 마감을 보여주는 것이 이 줄의 목적이라 머리글이 그것을 부정해서는 안 된다.
  return `\n📌 마감 — ${parts.join(' · ')}`;
};
