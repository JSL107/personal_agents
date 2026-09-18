export const HERMES_WATCHDOG_QUEUE = 'hermes-watchdog';

export interface HermesWatchdogJobData {
  ownerSlackUserId: string;
}

// 매일 08:30 KST — Hermes 아침신문 cron(08:00) 직후. 그날 실패를 아침에 알게 한다.
export const DEFAULT_HERMES_WATCHDOG_CRON = '30 8 * * *';
export const DEFAULT_HERMES_WATCHDOG_TIMEZONE = 'Asia/Seoul';

// next_run_at 이 이만큼 지났는데도 그대로면 Hermes 스케줄러 자체가 멈춘 것으로 본다.
// 1h — 08:00 job 을 08:30 에 볼 때 정상 갱신분(다음날 08:00)은 미래라 걸리지 않는다.
export const DEFAULT_SCHEDULER_STALE_MS = 60 * 60 * 1000;

// ~/.hermes/cron/jobs.json 의 job 한 건. 우리가 판정에 쓰는 필드만 선언한다
// (실제 파일에는 prompt/schedule/deliver 등이 더 있으나 읽지 않는다).
export interface HermesCronJobSnapshot {
  id?: string;
  name?: string;
  enabled?: boolean;
  last_status?: string | null;
  last_error?: string | null;
  last_run_at?: string | null;
  last_delivery_error?: string | null;
  next_run_at?: string | null;
}

export interface HermesCronSnapshot {
  jobs: HermesCronJobSnapshot[];
}
