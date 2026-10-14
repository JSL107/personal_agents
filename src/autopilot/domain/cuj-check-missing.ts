const DAY_MS = 24 * 60 * 60 * 1000;

// 회차 날짜(firedAtKst)의 KST 0시. 지금 시각이 아니라 회차 날짜로 잡아야 늦게 돈 회차·재실행이
// 다른 날을 판정하지 않는다(cuj-check.autopilot-task.ts 와 같은 이유).
export const getCujWatchTodayStart = (firedAtKst: string): Date =>
  new Date(`${firedAtKst}T00:00:00+09:00`);

// cuj-check(매일 09:10) 가 어제 아예 안 돌았는지. 작업이 예외로 끝나면 오케스트레이터가 이미
// 알리므로, 여기서 잡는 것은 "실행 자체가 없었던 날" 이다 — 앱이 꺼진 채 09:10 을 지나면
// BullMQ 는 놓친 회차를 다시 돌리지 않는다. 그 작업은 정상인 날에도 원장(slack_delivery)에
// 한 줄을 남기므로 원장이 비면 곧 실행이 없었던 것이다.
//
// `latestBeforeToday` 는 오늘 0시 **이전**의 마지막 기록이어야 한다. 오늘 기록까지 넣으면
// 브리핑이 09:10 뒤로 밀린 날 오늘 실행이 어제 결번을 가린다.
// 기록이 한 번도 없으면 감시 기준점이 없는 것이라 알리지 않는다(첫 실행 전날의 거짓 경보 방지).
export const isCujCheckMissingYesterday = (
  firedAtKst: string,
  latestBeforeToday: Date | null,
): boolean => {
  if (latestBeforeToday === null) {
    return false;
  }
  const yesterdayStart = new Date(
    getCujWatchTodayStart(firedAtKst).getTime() - DAY_MS,
  );
  return latestBeforeToday < yesterdayStart;
};
