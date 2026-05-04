// GitHub 표준 webhook 페이로드 — 이대리 자체 포맷(WebhookTriggerPayload) 으로 변환하기 위한 최소 형식.
// GitHub 가 보내는 실제 필드는 훨씬 많지만 이대리는 number / title / body / html_url / repository.full_name 만 사용.

export interface GithubRepository {
  full_name: string;
}

export interface GithubIssueLite {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
}

export interface GithubPullRequestLite {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
}

export interface GithubIssuesEvent {
  action: string; // 'opened' / 'closed' / 'reopened' / ...
  issue: GithubIssueLite;
  repository: GithubRepository;
}

export interface GithubPullRequestEvent {
  action: string;
  pull_request: GithubPullRequestLite;
  repository: GithubRepository;
}

export interface GithubCheckRunEvent {
  action: string; // 'created' | 'completed' | 'rerequested' | 'requested_action'
  check_run: {
    id: number;
    name: string;
    status: string; // 'queued' | 'in_progress' | 'completed'
    conclusion: string | null; // 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null
    head_sha: string;
    html_url: string;
    output?: { title?: string | null; summary?: string | null };
  };
  repository: { full_name: string };
}

export type GithubWebhookPayload =
  | GithubIssuesEvent
  | GithubPullRequestEvent
  | GithubCheckRunEvent;

// 헤더명 — 모두 소문자 (NestJS @Headers 파라미터는 lowercase 매칭).
export const GITHUB_EVENT_HEADER = 'x-github-event';
export const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256';
export const GITHUB_DELIVERY_HEADER = 'x-github-delivery';

// env 키 — GITHUB_WEBHOOK_SECRET 미설정 시 모든 GitHub webhook 요청 거부 (안전 기본).
// GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID 는 GitHub 페이로드에 slackUserId 가 없으므로
// 자동 발화될 impact-report 가 어느 사용자 컨텍스트로 실행될지 매핑하는 용도.
export const GITHUB_WEBHOOK_SECRET_ENV = 'GITHUB_WEBHOOK_SECRET';
export const GITHUB_WEBHOOK_OWNER_ENV = 'GITHUB_WEBHOOK_DEFAULT_SLACK_USER_ID';
