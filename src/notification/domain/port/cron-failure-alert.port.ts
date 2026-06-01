// cron consumer 가 graceful skip (NO_xxx) 외 throw 직전에 호출해 owner 에게 알리는 port.
// 대상 cron: Daily Eval / Impact Report Recent / CEO Meta Cron 등 — 실패 시 운영자가 즉시 인지.
// 구현체는 SlackCronFailureAlerter (env 설정 시) / NoopCronFailureAlerter (env 미설정 시 stdout 만).
// 30분 dedupe 는 구현체 책임 — fallback / 재시도가 짧은 시간 안 같은 실패를 반복할 수 있다.
export interface CronFailureAlertPort {
  notifyCronFailure(payload: CronFailureAlertPayload): Promise<void>;
}

export interface CronFailureAlertPayload {
  // 사람이 읽을 cron 이름 (예: 'Daily Eval', 'CEO Meta Cron'). 알람 본문 + dedupe key.
  cronName: string;
  // 해당 cron 이 처리하던 owner — 알람 메시지에 "어느 사용자 컨텍스트" 였는지 명시.
  ownerSlackUserId: string;
  // catch 한 에러 메시지 (raw). 최대 ~1KB 까지 그대로 노출 — 사용자가 root cause 진단 가능.
  errorMessage: string;
}

export const CRON_FAILURE_ALERT_PORT = Symbol('CRON_FAILURE_ALERT_PORT');
