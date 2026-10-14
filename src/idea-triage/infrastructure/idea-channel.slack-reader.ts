import { Inject, Injectable } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

import { SLACK_WEB_CLIENT } from '../../slack-collector/domain/port/slack-collector.port';
import {
  IdeaChannelMessage,
  IdeaChannelReaderPort,
} from '../domain/port/idea-channel-reader.port';

@Injectable()
export class IdeaChannelSlackReader implements IdeaChannelReaderPort {
  constructor(
    @Inject(SLACK_WEB_CLIENT) private readonly client: WebClient | null,
  ) {}

  async listRecent(
    channelId: string,
    oldest: Date,
  ): Promise<IdeaChannelMessage[] | null> {
    if (!this.client) {
      return null;
    }
    // ponytail: 페이지를 넘기지 않는다 — 7일 안에 최상위 글이 100건을 넘으면 오래된 글이 빠진다.
    // 회차당 판정 상한(10건)이 어차피 주 50건 수준이라 그 규모가 되면 cursor 순회와 상한을 함께 올린다.
    const response = await this.client.conversations.history({
      channel: channelId,
      oldest: String(oldest.getTime() / 1000),
      limit: 100,
    });
    return (response.messages ?? [])
      .filter(
        (message): message is typeof message & { ts: string } =>
          typeof message.ts === 'string',
      )
      .map((message) => ({
        ts: message.ts,
        text: message.text,
        user: message.user,
        threadTs: message.thread_ts,
        subtype: message.subtype,
        botId: message.bot_id,
      }));
  }

  async getPermalink(
    channelId: string,
    messageTs: string,
  ): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    try {
      const response = await this.client.chat.getPermalink({
        channel: channelId,
        message_ts: messageTs,
      });
      return response.permalink ?? null;
    } catch {
      // 퍼머링크 실패는 일정 등록을 막지 않는다.
      return null;
    }
  }
}
