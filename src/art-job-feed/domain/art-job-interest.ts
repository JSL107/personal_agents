import { addDays, PlainDate } from '../../agent/vacation/domain/plain-date';

// 「관심 있음」 공고의 마감 전날 DM 시각(KST). cron 표현식과 "알림이 남았나" 판정이 이 값 하나를 읽는다.
export const ART_JOB_REMINDER_HOURS_KST = [9, 13] as const;
const KST_OFFSET_HOURS = 9;

// 지금 눌러도 전날 알림을 한 번이라도 받는가 — 전날 마지막 회차 전이면 true.
// 아니면 누른 사람에게 알림이 없다고 그 자리에서 알린다(믿고 기다리다 마감을 놓치지 않게).
export const hasReminderLeft = (deadline: PlainDate, now: Date): boolean => {
  const eve = addDays(deadline, -1);
  const lastHour = Math.max(...ART_JOB_REMINDER_HOURS_KST);
  const lastSlotMs = Date.UTC(
    eve.year,
    eve.month - 1,
    eve.day,
    lastHour - KST_OFFSET_HOURS,
  );
  return now.getTime() < lastSlotMs;
};
