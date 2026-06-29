// Slack 보고서 렌더 결과. summary = 메인 메시지(헤드라인+핵심), detail = 스레드 상세.
export interface FormattedReport {
  summary: string;
  detail: string;
}
