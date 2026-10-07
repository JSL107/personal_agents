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

export interface SlackDeliveryRepositoryPort {
  record(input: RecordSlackDeliveryInput): Promise<void>;
}
