export const JOB_APPLICATION_NUDGE_CRON_QUEUE = 'job-application-nudge-cron';

export interface JobApplicationNudgeCronJobData {
  ownerSlackUserId: string;
  target: string;
}

// 매일 09:00 KST 기본 — 마감 임박/팔로업 지난 지원 건 넛지.
export const DEFAULT_JOB_APPLICATION_NUDGE_CRON = '0 9 * * *';
export const DEFAULT_JOB_APPLICATION_NUDGE_TIMEZONE = 'Asia/Seoul';

// 마감 임박 판정 윈도우 — 오늘부터 N일 이내 마감 건을 넛지 대상에 포함.
export const NUDGE_DEADLINE_WITHIN_DAYS = 3;
