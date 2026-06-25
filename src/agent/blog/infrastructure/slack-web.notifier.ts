import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

import {
  BlogSlackNotifierPort,
  BlogSlackNotifyInput,
} from '../domain/port/slack-notifier.port';

// blog.module useFactory 가 채우는 WebClient(또는 토큰 미설정 시 null) 주입 토큰.
export const BLOG_SLACK_WEB_CLIENT = Symbol('BLOG_SLACK_WEB_CLIENT');

// 비동기 BLOG 완료 후 같은 스레드에 답장하는 SlackNotifier 구현.
// 백그라운드에서 호출되므로 어떤 실패도 throw 하지 않는다(unhandled rejection 방지):
//   - SLACK_BOT_TOKEN 미설정 → client=null → warn 로그 후 noop.
//   - chat.postMessage 실패(scope/네트워크 등) → warn 로그 후 swallow.
@Injectable()
export class SlackWebNotifier implements BlogSlackNotifierPort {
  private readonly logger = new Logger(SlackWebNotifier.name);

  constructor(
    @Inject(BLOG_SLACK_WEB_CLIENT)
    private readonly client: WebClient | null,
  ) {}

  async notify({
    channel,
    threadTs,
    text,
  }: BlogSlackNotifyInput): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        `SLACK_BOT_TOKEN 미설정 — 비동기 BLOG 답장 생략 (channel=${channel}).`,
      );
      return;
    }
    try {
      await this.client.chat.postMessage({
        channel,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        text,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `비동기 BLOG 스레드 답장 실패 (channel=${channel} thread=${threadTs ?? '-'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
