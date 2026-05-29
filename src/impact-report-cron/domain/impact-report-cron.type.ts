export const IMPACT_REPORT_CRON_QUEUE = 'impact-report-cron';

export interface ImpactReportCronJobData {
  // GenerateImpactReportUsecase.execute({slackUserId}) 에 그대로 전달. cron 발화이므로
  // 사용자 명시 입력 없이 env (IMPACT_REPORT_RECENT_OWNER_SLACK_USER_ID) 에서 결정.
  ownerSlackUserId: string;
  // 결과 발송 대상 — Slack user(U...) / channel(C.../G...). 미설정 시 OWNER DM 으로 채워짐.
  target: string;
  // `--recent <N>d` 의 N. scheduler 가 env (default 7) 로 채워 전달.
  days: number;
}

// 기본 매주 토요일 09:00 KST — Weekly Summary (`0 17 * * 5`) / Daily Eval (`0 19 * * *`) 과 겹치지
// 않는 시간대 + 주말 휴식 시 본인 머지 PR 회고용. 사용자가 env 로 override 가능.
export const DEFAULT_IMPACT_REPORT_RECENT_CRON = '0 9 * * 6';
export const DEFAULT_IMPACT_REPORT_RECENT_TIMEZONE = 'Asia/Seoul';
// `--recent N` — 1~365 일. cron default 는 7 (주간 종합).
export const DEFAULT_IMPACT_REPORT_RECENT_DAYS = 7;
