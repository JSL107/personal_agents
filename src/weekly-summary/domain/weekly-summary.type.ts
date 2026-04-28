export const WEEKLY_SUMMARY_QUEUE = 'weekly-summary';

export interface WeeklySummaryJobData {
  ownerSlackUserId: string;
  target: string;
}

export const DEFAULT_WEEKLY_SUMMARY_CRON = '0 17 * * 5';
export const DEFAULT_WEEKLY_SUMMARY_TIMEZONE = 'Asia/Seoul';
