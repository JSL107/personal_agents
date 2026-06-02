// 단일 notification queue + job name 으로 알람 종류 분기.
// claude-auth-suspect: ModelRouterUsecase 의 ClaudeAuthSuspectException catch path.
// cron-failure: Daily Eval / Impact Report / CEO Meta Cron consumer 의 throw 직전.
//
// queue 패턴으로 분리한 이유 — PR #48 의 직접 inject (port + adapter) 가 ModelRouter → Notification →
// Slack → AgentModules → ModelRouter circular 를 만들어 InstanceLoader silent hang 유발.
// queue 는 Redis 만 의존 — 단방향 의존으로 cycle 없음.
export const NOTIFICATION_QUEUE = 'notification';

export const NOTIFICATION_JOB = {
  CLAUDE_AUTH_SUSPECT: 'claude-auth-suspect',
  CRON_FAILURE: 'cron-failure',
} as const;

export type NotificationJobName =
  (typeof NOTIFICATION_JOB)[keyof typeof NOTIFICATION_JOB];

export interface ClaudeAuthSuspectJobData {
  // claude CLI 의 exit 메시지 (인증/쿼터 의심 안내 포함). owner DM 본문에 그대로 노출.
  exitMessage: string;
}

export interface CronFailureJobData {
  // 사람이 읽을 cron 이름 (예: 'Daily Eval'). dedupe key + 알람 본문.
  cronName: string;
  // 해당 cron 의 owner — 알람 본문 표기.
  ownerSlackUserId: string;
  // catch 한 raw 에러 메시지.
  errorMessage: string;
}

export type NotificationJobData = ClaudeAuthSuspectJobData | CronFailureJobData;
