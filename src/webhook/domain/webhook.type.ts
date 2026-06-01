export type WebhookEventType = 'issues.opened' | 'pull_request.opened';

export interface WebhookTriggerPayload {
  event: WebhookEventType;
  repo: string; // "owner/repo"
  data: {
    number?: number;
    title?: string;
    body?: string;
    url?: string;
  };
  slackUserId: string;
}

export const WEBHOOK_SECRET_ENV = 'WEBHOOK_SECRET';

// Webhook 으로 발화된 impact-report 를 직렬 처리하는 BullMQ 큐.
// 기존 fire-and-forget 패턴은 burst (예: monorepo 에 10개 issue 동시 open) 시 LLM CLI 가
// 동시 N개 spawn 돼 quota 폭주/리소스 고갈 위험 (V3 audit B2 #4 / B3 P5 / B4 H-2).
// 큐 + concurrency=1 로 직렬화 — Slack 200 OK 응답은 즉시, 실제 LLM 호출은 백그라운드.
export const IMPACT_REPORT_QUEUE = 'impact-report-webhook';

export interface ImpactReportJobData {
  subject: string;
  slackUserId: string;
}

// pull_request.opened webhook 트리거. PR 메타로 BE-Fix 자동 분석.
export const BE_FIX_QUEUE = 'be-fix-webhook';

export interface BeFixJobData {
  prRef: string; // 'owner/repo#number'
  slackUserId: string;
}

// check_run.completed (conclusion: failure) webhook 트리거. workflow 메타로 stack trace 합성.
export const BE_SRE_QUEUE = 'be-sre-webhook';

export interface BeSreJobData {
  // BE-SRE usecase 가 stackTrace string 을 받으므로, webhook payload 의 핵심 메타를
  // 구조화된 텍스트로 합성해 전달한다 (실제 stack 은 workflow log 에 있어 별도 fetch 필요 — MVP 보류).
  stackTrace: string;
  slackUserId: string;
}

// pull_request.opened webhook 트리거 — 본인 PR (owner login 일치, bot 제외) 일 때만 자동 /review-pr.
// 결과는 Slack DM 으로 owner 에게 발송. 동일 PR (force-push / re-deliver) 은 BullMQ jobId 로 dedup.
export const CODE_REVIEWER_QUEUE = 'code-reviewer-webhook';

export interface CodeReviewerJobData {
  prRef: string; // 'owner/repo#number'
  slackUserId: string;
}

// pull_request.closed (merged=true) webhook 트리거 — 본인 PR 머지 시 careerLog 한 줄을 Notion 페이지에 자동 적재.
// 매일 머지하는 행위가 자산으로 자동 누적 — /po-eval ✅ 수동 적재의 PR 단위 자동화 자매.
// LLM 호출 X — PR 메타 (title / body / additions / deletions / files) 를 그대로 careerLog block 으로 변환.
export const PR_CAREERLOG_QUEUE = 'pr-careerlog-webhook';

export interface PrCareerLogJobData {
  prRef: string; // 'owner/repo#number'
  slackUserId: string;
}
