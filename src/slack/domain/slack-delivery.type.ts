export const SLACK_DELIVERY_STATUS = {
  SENT: 'SENT',
  SUPPRESSED: 'SUPPRESSED',
  FAILED: 'FAILED',
} as const;

export type SlackDeliveryStatus =
  (typeof SLACK_DELIVERY_STATUS)[keyof typeof SLACK_DELIVERY_STATUS];

export const SLACK_DELIVERY_SUPPRESS_REASON = {
  CONSOLE_ROUTE: 'CONSOLE_ROUTE',
  EMPTY: 'EMPTY',
} as const;

export type SlackDeliverySuppressReason =
  (typeof SLACK_DELIVERY_SUPPRESS_REASON)[keyof typeof SLACK_DELIVERY_SUPPRESS_REASON];

export type DeliveryKind =
  | `autopilot:${string}`
  | 'study-brief'
  | 'resume-calibration'
  | 'job-application-nudge'
  | 'code-review-webhook'
  | 'pr-careerlog'
  | 'alert:claude-auth'
  | 'alert:cron-failure';

export const buildTextPreview = (text: string): string => text.slice(0, 200);
