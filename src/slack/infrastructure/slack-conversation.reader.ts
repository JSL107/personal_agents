import { Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

import { SlackTranscriptMessage } from '../domain/slack-transcript';

export const THREAD_MESSAGE_LIMIT = 30;
export const DM_TOP_LEVEL_MESSAGE_LIMIT = 15;
export const DM_TOP_LEVEL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DM_THREAD_ENRICH_LIMIT = 3;

export interface ReadConversationInput {
  client: WebClient;
  channelId: string;
  isDirectMessage: boolean;
  threadTs?: string;
  messageTs?: string;
  nowMs: number;
}

// Slack API 응답에서 기록에 필요한 필드만 옮긴다.
interface SlackMessage {
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
  files?: {
    id?: string;
    mimetype?: string;
    size?: number;
    url_private_download?: string;
  }[];
}

@Injectable()
export class SlackConversationReader {
  private readonly logger = new Logger(SlackConversationReader.name);
  private botIdPromise?: Promise<string | undefined>;

  async selfBotId(client: WebClient): Promise<string | undefined> {
    this.botIdPromise ??= client.auth
      .test()
      .then((response) => response.bot_id)
      .catch(() => undefined);
    return this.botIdPromise;
  }

  async read(
    input: ReadConversationInput,
  ): Promise<SlackTranscriptMessage[] | null> {
    if (!input.threadTs && !input.isDirectMessage) {
      return null;
    }
    try {
      if (input.threadTs) {
        const messages = await this.readThread(
          input.client,
          input.channelId,
          input.threadTs,
        );
        return messages.length > THREAD_MESSAGE_LIMIT
          ? [messages[0], ...messages.slice(-(THREAD_MESSAGE_LIMIT - 1))]
          : messages;
      }
      const response = await input.client.conversations.history({
        channel: input.channelId,
        limit: DM_TOP_LEVEL_MESSAGE_LIMIT,
        oldest: String((input.nowMs - DM_TOP_LEVEL_WINDOW_MS) / 1000),
        ...(input.messageTs ? { latest: input.messageTs } : {}),
        inclusive: false,
        include_all_metadata: true,
      });
      const history = (response.messages ?? []).map(toTranscriptMessage);
      const parents = history
        .filter((message) => (message.replyCount ?? 0) > 0)
        .sort((left, right) => Number(right.ts) - Number(left.ts))
        .slice(0, DM_THREAD_ENRICH_LIMIT);
      const threads = await Promise.all(
        parents.map(async (parent) => {
          try {
            return await this.readThread(
              input.client,
              input.channelId,
              parent.ts,
            );
          } catch (error) {
            // 스레드 하나가 실패해도 나머지 기록으로 답한다.
            this.logger.warn(
              `Slack 스레드 보강 조회 실패 (channel=${input.channelId} ts=${parent.ts}): ${error instanceof Error ? error.message : String(error)}`,
            );
            return [];
          }
        }),
      );
      const unique = new Map<string, SlackTranscriptMessage>();
      for (const message of [...history, ...threads.flat()]) {
        if (input.messageTs && Number(message.ts) >= Number(input.messageTs)) {
          continue;
        }
        unique.set(message.ts, message);
      }
      return [...unique.values()].sort(
        (left, right) => Number(left.ts) - Number(right.ts),
      );
    } catch (error) {
      // 맥락 보강 때문에 답을 막지 않는다 — 호출자는 null 이면 Redis 기억으로 답한다.
      this.logger.warn(
        `Slack 대화 기록 조회 실패 — Redis 기억으로 진행 (channel=${input.channelId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async readThread(
    client: WebClient,
    channelId: string,
    threadTs: string,
  ): Promise<SlackTranscriptMessage[]> {
    // shortcut: 200개 넘는 스레드는 앞 200개의 뒤 30개를 쓴다(최신 30개가 아님), 그런 스레드가 실제로 생기면 cursor 순회.
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
      include_all_metadata: true,
    });
    return (response.messages ?? []).map(toTranscriptMessage);
  }
}

const toTranscriptMessage = (
  message: SlackMessage,
): SlackTranscriptMessage => ({
  ts: message.ts ?? '',
  text: message.text ?? '',
  ...(message.user ? { user: message.user } : {}),
  ...(message.bot_id ? { botId: message.bot_id } : {}),
  ...(message.thread_ts ? { threadTs: message.thread_ts } : {}),
  ...(message.reply_count !== undefined
    ? { replyCount: message.reply_count }
    : {}),
  ...(message.metadata?.event_type
    ? {
        metadata: {
          eventType: message.metadata.event_type,
          eventPayload: message.metadata.event_payload ?? {},
        },
      }
    : {}),
  files: (message.files ?? []).map((file) => ({
    id: file.id ?? '',
    mimetype: file.mimetype ?? '',
    size: file.size ?? 0,
    urlPrivateDownload: file.url_private_download ?? '',
  })),
});
