// Daily Eval 기본 스케줄 — 기존 src/daily-eval/domain/daily-eval.type.ts 에서 승계.
export const DEFAULT_DAILY_EVAL_CRON = '0 19 * * *';
export const DEFAULT_DAILY_EVAL_TIMEZONE = 'Asia/Seoul';

// Morning Briefing 기본 스케줄 — 기존 src/morning-briefing/domain/morning-briefing.type.ts 승계.
export const DEFAULT_MORNING_BRIEFING_CRON = '30 8 * * *';
export const DEFAULT_MORNING_BRIEFING_TIMEZONE = 'Asia/Seoul';

// Weekly Summary 기본 스케줄 — 기존 src/weekly-summary/domain/weekly-summary.type.ts 승계.
// 매주 금요일 17:00 KST — worklog(주간) + CEO meta 체인.
export const DEFAULT_WEEKLY_SUMMARY_CRON = '0 17 * * 5';
export const DEFAULT_WEEKLY_SUMMARY_TIMEZONE = 'Asia/Seoul';

// CEO Meta 기본 스케줄 — 기존 src/ceo-meta-cron/domain/ceo-meta-cron.type.ts 승계.
// 매주 일요일 18:00 KST — Weekly Summary(금) 와 분리해 한 주 마감 시점.
export const DEFAULT_CEO_META_CRON = '0 18 * * 0';
export const DEFAULT_CEO_META_TIMEZONE = 'Asia/Seoul';

// Impact Report 기본 스케줄 — 기존 src/impact-report-cron/domain/impact-report-cron.type.ts 승계.
// 매주 토요일 09:00 KST — Weekly Summary(금) / Daily Eval(매일) 과 겹치지 않는 시간대.
export const DEFAULT_IMPACT_REPORT_CRON = '0 9 * * 6';
export const DEFAULT_IMPACT_REPORT_TIMEZONE = 'Asia/Seoul';
