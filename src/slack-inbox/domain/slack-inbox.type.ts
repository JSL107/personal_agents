export interface SlackInboxItem {
  id: number;
  slackUserId: string;
  channelId: string;
  messageTs: string;
  text: string;
  addedAt: Date;
  consumed: boolean;
}
