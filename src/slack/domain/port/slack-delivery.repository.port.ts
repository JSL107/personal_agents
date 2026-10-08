import {
  DeliveryKind,
  SlackDeliveryStatus,
  SlackDeliverySuppressReason,
} from '../slack-delivery.type';

export const SLACK_DELIVERY_REPOSITORY = Symbol('SLACK_DELIVERY_REPOSITORY');

export type RecordSlackDeliveryInput = {
  kind: DeliveryKind;
  itemKinds: string[];
  target: string;
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
  status: SlackDeliveryStatus;
  suppressReason?: SlackDeliverySuppressReason;
  textPreview: string;
  fullText?: string;
  errorMessage?: string;
};

export type SlackDeliveryMessageRef = {
  channelId: string;
  messageTs: string;
};

export type SlackDeliveryStatRow = {
  kind: string;
  itemKinds: string[];
  // 스레드 상세 댓글이면 본문 메시지 ts. 발송 수는 본문만 센다(slack-delivery-summary.ts).
  threadTs: string | null;
  status: SlackDeliveryStatus;
  suppressReason: string | null;
  reactionCount: number;
  replyCount: number;
};

export type SlackDeliveryListInput = {
  status: SlackDeliveryStatus;
  since: Date;
  limit: number;
};

export type SlackDeliveryListRow = SlackDeliveryStatRow & {
  id: number;
  target: string;
  channelId: string | null;
  messageTs: string | null;
  textPreview: string;
  fullText: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

export interface SlackDeliveryRepositoryPort {
  record(input: RecordSlackDeliveryInput): Promise<void>;
  incrementReactionCount(target: SlackDeliveryMessageRef): Promise<number>;
  incrementReplyCount(target: SlackDeliveryMessageRef): Promise<number>;
  // until 은 선택 — 주어지면 createdAt < until 로 끝을 닫는다(기간이 고정된 주간 요약용).
  findSince(since: Date, until?: Date): Promise<SlackDeliveryStatRow[]>;
  findByStatus(input: SlackDeliveryListInput): Promise<SlackDeliveryListRow[]>;
}
