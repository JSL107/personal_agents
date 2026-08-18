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

// 모의투자 일일 평가 기본 스케줄 — 국내 장 마감·시세 적재 이후 평일 17:40 KST.
export const DEFAULT_PAPER_TRADING_CRON = '40 17 * * 1-5';
export const DEFAULT_PAPER_TRADING_TIMEZONE = 'Asia/Seoul';

// KRX 유니버스 동기화·증분 시세 수집 — 감시/모의투자 평가 이후 매일 18:30 KST.
export const DEFAULT_UNIVERSE_SWEEP_CRON = '30 18 * * *';
export const DEFAULT_UNIVERSE_SWEEP_TIMEZONE = 'Asia/Seoul';

// 모의투자 추천 — 평일 유니버스 수집 완료와 재시도 여유 뒤 19:30 KST.
export const DEFAULT_PAPER_RECOMMEND_CRON = '30 19 * * 1-5';
export const DEFAULT_PAPER_RECOMMEND_TIMEZONE = 'Asia/Seoul';

// 모의투자 주문 체결 — 평일 09:00~15:59 10분 주기. 실제 처리 창은 usecase가 판정한다.
export const DEFAULT_PAPER_ORDER_FILL_CRON = '*/10 9-15 * * 1-5';
export const DEFAULT_PAPER_ORDER_FILL_TIMEZONE = 'Asia/Seoul';

// 모의투자 추천 성적 — 금요일 20:10 KST 주 1회.
//
// 채점은 당일 종가에 의존한다. 청산일·평가기준일의 `DailyPrice` 와 `BenchmarkDailyClose` 가
// 있어야 그날 청산된 추천의 초과수익과 보유 중 추천의 미실현 수익률이 나온다. 그런데 그 데이터를
// 적재하는 `universe-sweep` 은 18:30 에 시작해 실측 18:39 에 끝난다. 채점을 그보다 앞에 두면
// **매주 성적표에서 그날 몫이 통째로 결손·미산출로 빠진다.**
// 수집(18:39)과 추천(19:30) 이 모두 끝난 뒤로 둔다.
export const DEFAULT_PAPER_SCORE_CRON = '10 20 * * 5';
export const DEFAULT_PAPER_SCORE_TIMEZONE = 'Asia/Seoul';

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

// PR 리뷰 루프 스윕 — 3분 주기. 할 일 없으면 skip 하므로 알림 스팸은 없다.
//
// 15분 → 5분: 이 레포의 PR 수명이 30분 남짓이라(#196 34분, #197 35분) 15분 주기면 리뷰 기회가
// 1~2회뿐이고, 그중 한 번이라도 모델 호출이 실패하면 그 PR 은 리뷰 없이 머지된다
// (2026-07-31 실측: 08:01 스윕 실패 → 다음 기회 08:45 에는 두 PR 다 이미 머지됨).
//
// 5분 → 3분: PR 수명이 더 짧아졌다 — 2026-08-06 실측 8건 중 #250 이 4분(05:29 열림 → 05:33
// 머지), #249 가 8분. 5분 주기는 착수 대기만 27초~4분이라(실측) 리뷰가 머지를 못 따라간다.
// 3분을 하한으로 잡은 근거는 스윕 1회 실측 소요 28~142초 — autopilot-cron 큐는 concurrency=1
// 직렬이라 주기가 소요를 밑돌면 tick 이 큐에 밀려 실효 주기가 오히려 흔들린다. 2분은 실측
// 8건 중 2건(130·142초)이 주기를 넘겨 그 상태가 상시화되므로, 최대 소요를 덮는 3분을 쓴다.
// 열린 PR 이 없으면 GitHub 조회만 하고 끝나므로(실측 14~47초, LLM 미호출) 주기를 줄이는 비용은 작다.
export const DEFAULT_PR_REVIEW_SWEEP_CRON = '*/3 * * * *';
export const DEFAULT_PR_REVIEW_SWEEP_TIMEZONE = 'Asia/Seoul';

// 포트폴리오 사이트 발행 — 매일 23:00 KST.
//
// 저녁 회고(DEFAULT_DAILY_EVAL_CRON, 19:00)가 경력 프로필을 갱신하고 그 승인 카드가 눌릴
// 여유를 4시간 둔 뒤 발행한다. 승인이 안 눌린 날은 이전 프로필을 다시 밀어 넣지만
// slug 멱등이라 중복 항목이 생기지 않는다.
// 워밍업 시간대(08~24시) 안이라 사이트가 깨어 있는 시각이기도 하다.
export const DEFAULT_PORTFOLIO_PUBLISH_CRON = '0 23 * * *';
export const DEFAULT_PORTFOLIO_PUBLISH_TIMEZONE = 'Asia/Seoul';

// 포트폴리오 사이트(Portfolio OS) 워밍업 — 10분 주기, 08~24시(KST)만.
//
// 사이트 API 는 Render 무료 플랜이라 15분 유휴면 잠들고, 깨어나는 첫 요청이 18.4초 걸린다
// (2026-08-18 실측). 주기가 유휴 기준 15분보다 짧아야 잠들기 전에 깨울 수 있어 10분으로 둔다.
//
// 시간대를 24시간으로 넓히지 않는 이유 — 무료 플랜은 워크스페이스당 월 750 인스턴스 시간이고,
// 소진하면 그 달이 끝날 때까지 무료 웹 서비스 전체가 정지된다. 잠든 동안은 시간을 소비하지
// 않으므로 워밍업 범위가 곧 과금 시간이다: 24시간 상시는 31일 달에 744시간(여유 6시간)이라
// 무료 서비스를 하나만 더 만들어도 초과하고, 08~24시는 496시간(여유 254시간)이다.
export const DEFAULT_PORTFOLIO_WARMUP_CRON = '*/10 8-23 * * *';
export const DEFAULT_PORTFOLIO_WARMUP_TIMEZONE = 'Asia/Seoul';

export const DEFAULT_AI_CLI_ENV_SNAPSHOT_CRON = '0 19 * * 5';
export const DEFAULT_AI_CLI_ENV_SNAPSHOT_TIMEZONE = 'Asia/Seoul';
export const DEFAULT_AI_CLI_ENV_APPLY_CRON = '0 10 * * *';
export const DEFAULT_AI_CLI_ENV_APPLY_TIMEZONE = 'Asia/Seoul';
