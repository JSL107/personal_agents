// Daily Eval 기본 스케줄 — 기존 src/daily-eval/domain/daily-eval.type.ts 에서 승계.
export const DEFAULT_DAILY_EVAL_CRON = '0 19 * * *';
export const DEFAULT_DAILY_EVAL_TIMEZONE = 'Asia/Seoul';

// Morning Briefing 기본 스케줄 — 기존 src/morning-briefing/domain/morning-briefing.type.ts 승계.
export const DEFAULT_MORNING_BRIEFING_CRON = '30 8 * * *';
export const DEFAULT_MORNING_BRIEFING_TIMEZONE = 'Asia/Seoul';

// CTO 배정 + PO Shadow 검토 기본 스케줄 — 매일 13:00 KST(점심 직후, 아침 plan 의 오후 태스크 대상).
export const DEFAULT_NOON_REVIEW_CRON = '0 13 * * *';
export const DEFAULT_NOON_REVIEW_TIMEZONE = 'Asia/Seoul';

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

// Run Sweeper 기본 스케줄 — 매시간 :50. 좀비 IN_PROGRESS 를 FAILED 로 정리하고 콘솔에
// run.finished/state.changed 를 발행한다. 주 1회면 SSE 로만 갱신되는 라이브 콘솔이 최대 6일
// "일하는 중" 오표시되므로, 매시간으로 지연을 ~1h 로 단축. 좀비 0건이면 skip(무발송)이라 스팸 없음.
export const DEFAULT_RUN_SWEEPER_CRON = '50 * * * *';
export const DEFAULT_RUN_SWEEPER_TIMEZONE = 'Asia/Seoul';

// Knowledge Lint 기본 스케줄 — 매주 일 10:00 KST(run-retro 월 09:00 / ceo-meta 일 18:00 과 시간 분리).
// episodic-memory 규모가 작아 일간은 과함 → 주간 무결성 점검.
export const DEFAULT_KNOWLEDGE_LINT_CRON = '0 10 * * 0';
export const DEFAULT_KNOWLEDGE_LINT_TIMEZONE = 'Asia/Seoul';

// docs-sync-audit 기본 스케줄 — 매주 일 11:00 KST (knowledge-lint 일 10:00 과 1시간 분리).
export const DEFAULT_DOCS_AUDIT_CRON = '0 11 * * 0';
export const DEFAULT_DOCS_AUDIT_TIMEZONE = 'Asia/Seoul';

// Preference Learning 기본 스케줄 — 매주 일 12:00 KST(docs-audit 일 11:00 과 1시간 분리).
export const DEFAULT_PREFERENCE_LEARNING_CRON = '0 12 * * 0';
export const DEFAULT_PREFERENCE_LEARNING_TIMEZONE = 'Asia/Seoul';

// Ops Supervisor 기본 스케줄 — 매월 1일 09:00 KST(지난 30일 품질 리뷰).
export const DEFAULT_OPS_SUPERVISOR_CRON = '0 9 1 * *';
export const DEFAULT_OPS_SUPERVISOR_TIMEZONE = 'Asia/Seoul';

// 주식 모니터링 기본 스케줄 — 국내 장 마감·지연 시세 반영 후 평일 17:10 KST.
export const DEFAULT_STOCK_MONITOR_CRON = '10 17 * * 1-5';
export const DEFAULT_STOCK_MONITOR_TIMEZONE = 'Asia/Seoul';

// Preview Sweeper 기본 스케줄 — 10분마다. 만료 카드는 목록(findAllOpen)에서는 즉시 빠지지만
// 콘솔이 구독하는 approval.resolved 는 이 스위퍼가 돌 때만 발행된다. 매시간이면 SESSION_INJECT
// TTL(30분)이 지난 카드가 최대 1시간 동안 콘솔 화면에 남아, 눌러도 서버가 거절하는 유령 버튼이 됐다.
export const DEFAULT_PREVIEW_SWEEPER_CRON = '*/10 * * * *';
export const DEFAULT_PREVIEW_SWEEPER_TIMEZONE = 'Asia/Seoul';

// 주식 알림 사후 채점 기본 스케줄 — 모니터링 이후 평일 18:00 KST.
export const DEFAULT_STOCK_ALERT_SCORING_CRON = '0 18 * * 1-5';
export const DEFAULT_STOCK_ALERT_SCORING_TIMEZONE = 'Asia/Seoul';

// 미국 주식 모니터링 기본 스케줄 — 미국 정규장 마감 30분 후 평일 16:30 ET.
export const DEFAULT_STOCK_MONITOR_US_CRON = '30 16 * * 1-5';
export const DEFAULT_STOCK_MONITOR_US_TIMEZONE = 'America/New_York';

// PR 리뷰 루프 스윕 — 15분 주기. 할 일 없으면 skip 하므로 알림 스팸은 없다.
export const DEFAULT_PR_REVIEW_SWEEP_CRON = '*/15 * * * *';
export const DEFAULT_PR_REVIEW_SWEEP_TIMEZONE = 'Asia/Seoul';
