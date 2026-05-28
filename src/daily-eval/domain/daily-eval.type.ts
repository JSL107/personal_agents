export const DAILY_EVAL_QUEUE = 'daily-eval';

export interface DailyEvalJobData {
  ownerSlackUserId: string;
  target: string;
}

// 매일 19:00 KST. workflow-phase-definition §5.2 의 Daily Eval 정의 차용.
// PRO-4 Weekly Summary (`0 17 * * 5`) 와 별도 cron — 일일 회고 누적 → CEO weekly meta 의 입력이
// 충분히 쌓이도록 한다.
export const DEFAULT_DAILY_EVAL_CRON = '0 19 * * *';
export const DEFAULT_DAILY_EVAL_TIMEZONE = 'Asia/Seoul';
