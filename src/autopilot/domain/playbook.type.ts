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

// 알림 성격이 다른 묶음. 라인마다 발송 대상을 따로 둘 수 있다(AUTOPILOT_<LINE>_TARGET).
export type PlaybookLine = 'invest';

export interface PlaybookEntry {
  id: string; // 안정 식별자(job name·멱등 키·로그). 예: 'daily-eval'
  taskId: string; // 실행할 AutopilotTask.id
  trigger: PlaybookTrigger;
  riskTier: RiskTier;
  digestGroup?: string; // SP2+ 다중 전달 묶기용. SP1 미사용.
  line?: PlaybookLine; // 발송 대상 분리용. 미지정이면 공통 AUTOPILOT_TARGET.
}
