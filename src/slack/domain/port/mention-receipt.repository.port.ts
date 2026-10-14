export const MENTION_RECEIPT_REPOSITORY = Symbol('MENTION_RECEIPT_REPOSITORY');

export const MENTION_RECEIPT_STATUS = {
  RECEIVED: 'RECEIVED',
  REPLIED: 'REPLIED',
  // 사용자에게 「처리 실패」 안내만 나간 경우 — 답은 갔지만 요청은 처리되지 않았다.
  ERROR_REPLIED: 'ERROR_REPLIED',
  REPLY_FAILED: 'REPLY_FAILED',
} as const;

export type MentionReceiptStatus =
  (typeof MENTION_RECEIPT_STATUS)[keyof typeof MENTION_RECEIPT_STATUS];

export const MENTION_FINAL_REPLY_STATUS = {
  PENDING: 'PENDING',
  POSTED: 'POSTED',
  FAILED: 'FAILED',
} as const;

export type MentionFinalReplyStatus =
  (typeof MENTION_FINAL_REPLY_STATUS)[keyof typeof MENTION_FINAL_REPLY_STATUS];

export type MentionReceiptRef = {
  channelId: string;
  messageTs: string;
};

export type RecordMentionReceivedInput = MentionReceiptRef & {
  source: 'app_mention' | 'dm';
};

export type RecordMentionOutcomeInput = MentionReceiptRef & {
  status: Exclude<MentionReceiptStatus, 'RECEIVED'>;
  errorMessage?: string;
};

export interface MentionReceiptRepositoryPort {
  // Slack 이 같은 이벤트를 다시 보내도 첫 수신 행 하나만 남긴다.
  recordReceived(input: RecordMentionReceivedInput): Promise<void>;
  recordOutcome(input: RecordMentionOutcomeInput): Promise<void>;
  recordFinalReply(
    input: MentionReceiptRef & { status: MentionFinalReplyStatus },
  ): Promise<void>;
}
