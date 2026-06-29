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

// Run Retro 기본 스케줄 — 매주 월 09:00 KST(한 주 시작 시점에 지난 7일 실행 통계 회고).
export const DEFAULT_RUN_RETRO_CRON = '0 9 * * 1';
export const DEFAULT_RUN_RETRO_TIMEZONE = 'Asia/Seoul';

// Knowledge Lint 기본 스케줄 — 매주 일 10:00 KST(run-retro 월 09:00 / ceo-meta 일 18:00 과 시간 분리).
// episodic-memory 규모가 작아 일간은 과함 → 주간 무결성 점검.
export const DEFAULT_KNOWLEDGE_LINT_CRON = '0 10 * * 0';
export const DEFAULT_KNOWLEDGE_LINT_TIMEZONE = 'Asia/Seoul';

// docs-sync-audit 기본 스케줄 — 매주 일 11:00 KST (knowledge-lint 일 10:00 과 1시간 분리).
export const DEFAULT_DOCS_AUDIT_CRON = '0 11 * * 0';
export const DEFAULT_DOCS_AUDIT_TIMEZONE = 'Asia/Seoul';
