const DAY_MS = 24 * 60 * 60 * 1000;

// 아침 브리핑이 원장(slack_delivery.item_kinds)으로 결번을 지켜보는 자동 작업.
// 대상은 결번을 다른 누구도 모르는 작업이다 — cuj-check 는 자기가 안 돈 날을 스스로 못 알리고,
// run-retro 는 콘솔 경로라 산출물이 Slack 에 닿지 않는 데다 자기 결번 탐지(detectMissingWeeklyRuns)의
// 대상도 아니다. 둘 다 정상 회차마다 원장에 한 줄을 남긴다(콘솔 경로는 SUPPRESSED/CONSOLE_ROUTE).
//
// `periodDays` 는 cron 주기다. 판정을 날짜 단위로 하므로 회차가 몇 분·몇 시간 밀려도 같은 날에
// 남는 한 오탐하지 않는다(run-retro.anomaly.ts 의 weeklyMissingDays 가 피하려던 경계 문제).
export interface LedgerGapWatch {
  taskId: string;
  label: string;
  periodDays: number;
}

export const LEDGER_GAP_WATCHES: readonly LedgerGapWatch[] = [
  // 매일 09:10
  { taskId: 'cuj-check', label: 'CUJ 점검', periodDays: 1 },
  // 매주 월 09:00 — 결번이면 화요일 브리핑부터 다음 회차까지 매일 뜬다. 이번주 실행이 0건이고 이상도
  // 없으면 skip 해 원장이 비는데, 그건 일주일 내내 아무것도 안 돈 상황이라 울려도 맞다.
  { taskId: 'run-retro', label: '주간 실행 회고', periodDays: 7 },
];

// 회차 날짜(firedAtKst)의 KST 0시. 지금 시각이 아니라 회차 날짜로 잡아야 늦게 돈 회차·재실행이
// 다른 날을 판정하지 않는다(cuj-check.autopilot-task.ts 와 같은 이유).
export const getLedgerWatchTodayStart = (firedAtKst: string): Date =>
  new Date(`${firedAtKst}T00:00:00+09:00`);

// 직전 주기 안에 원장 기록이 없는지. 비는 원인은 대부분 실행 자체가 없었던 날이다 — 앱이 꺼진 채
// 회차 시각을 지나면 BullMQ 는 놓친 회차를 다시 돌리지 않는다. 다만 작업 예외(이미 즉시 알림이 나감)나
// 원장 기록 실패(로그만 남김)로도 비므로 "실행 안 됨" 이 아니라 "기록 없음" 으로 알린다.
//
// `latestBeforeToday` 는 오늘 0시 **이전**의 마지막 기록이어야 한다. 오늘 기록까지 넣으면
// 브리핑이 회차 시각 뒤로 밀린 날 오늘 실행이 지난 결번을 가린다.
// 기록이 한 번도 없으면 감시 기준점이 없는 것이라 알리지 않는다(첫 실행 전의 거짓 경보 방지).
export const isLedgerGap = (
  firedAtKst: string,
  latestBeforeToday: Date | null,
  periodDays: number,
): boolean => {
  if (latestBeforeToday === null) {
    return false;
  }
  const windowStart = new Date(
    getLedgerWatchTodayStart(firedAtKst).getTime() - periodDays * DAY_MS,
  );
  return latestBeforeToday < windowStart;
};
