export type RiskTier = 'T0_AUTO' | 'T1_PREVIEW';

// SP1: CRON 실행만. EVENT 는 스키마만 정의(실행은 SP4).
export interface CronTrigger {
  kind: 'CRON';
  schedule: string; // cron pattern (env override 가능)
  timezone: string; // 예: 'Asia/Seoul'
}

export interface EventTrigger {
  kind: 'EVENT';
  event: string; // 예: 'github.pull_request.opened' — SP4 라우팅
}

export type PlaybookTrigger = CronTrigger | EventTrigger;

export interface PlaybookEntry {
  id: string; // 안정 식별자(job name·멱등 키·로그). 예: 'daily-eval'
  taskId: string; // 실행할 AutopilotTask.id
  trigger: PlaybookTrigger;
  riskTier: RiskTier;
  digestGroup?: string; // SP2+ 다중 전달 묶기용. SP1 미사용.
}
