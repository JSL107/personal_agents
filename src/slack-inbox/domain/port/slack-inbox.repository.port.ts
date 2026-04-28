import { SlackInboxItem } from '../slack-inbox.type';

export const SLACK_INBOX_REPOSITORY_PORT = Symbol(
  'SLACK_INBOX_REPOSITORY_PORT',
);

export interface SlackInboxRepositoryPort {
  upsert(item: {
    slackUserId: string;
    channelId: string;
    messageTs: string;
    text: string;
  }): Promise<void>;
  findPendingForUser(slackUserId: string): Promise<SlackInboxItem[]>;
  markConsumed(ids: number[]): Promise<void>;
}
