export const IDEA_CHANNEL_READER_PORT = Symbol('IDEA_CHANNEL_READER_PORT');

export interface IdeaChannelMessage {
  ts: string;
  text?: string;
  user?: string;
  threadTs?: string;
  subtype?: string;
  botId?: string;
}

export interface IdeaChannelReaderPort {
  // 토큰이 없으면 null. 채널 호출 실패는 예외로 전달한다.
  listRecent(
    channelId: string,
    oldest: Date,
  ): Promise<IdeaChannelMessage[] | null>;
  getPermalink(channelId: string, messageTs: string): Promise<string | null>;
}
