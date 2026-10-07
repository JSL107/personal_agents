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
  findSince(since: Date): Promise<SlackDeliveryStatRow[]>;
  findByStatus(input: SlackDeliveryListInput): Promise<SlackDeliveryListRow[]>;
}
