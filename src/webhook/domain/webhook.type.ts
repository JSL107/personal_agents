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
