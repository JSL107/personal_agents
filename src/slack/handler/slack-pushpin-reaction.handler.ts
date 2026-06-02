import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';

import { AppendPushpinTaskService } from '../../pushpin-task/application/append-pushpin-task.service';
import { SlackHandler } from '../domain/port/slack-handler.port';

// 📌 (default) reaction 이 메시지에 달리면 그 메시지를 Notion task 페이지에 자동 적재.
// SlackInboxReactionHandler 의 inbox 트리거와 독립 — 사용자가 다른 이모지를 task 와 inbox 분리 가능.
//
// env:
//   SLACK_PUSHPIN_REACTION_EMOJI       — 트리거 이모지 (default 'pushpin').
//   SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID — 적재할 Notion 부모 페이지 id (필수). 미설정 시 service 가 skip.
//
// reaction_added event 는 멱등하지 않다 (toggle off → on 시 두 번 발화 가능) — service 책임 범위 안에서
// 처리한다 (현재 단계는 추가 dedup 없음, 비용/가치 트레이드오프).
@Injectable()
export class SlackPushpinReactionHandler implements SlackHandler {
  private readonly logger = new Logger(SlackPushpinReactionHandler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly appendPushpinTaskService: AppendPushpinTaskService,
  ) {}

  register(app: App): void {
    const pushpinEmoji =
      this.configService.get<string>('SLACK_PUSHPIN_REACTION_EMOJI') ??
      'pushpin';

    app.event('reaction_added', async ({ event, client }) => {
      if (event.reaction !== pushpinEmoji) {
        return;
      }
      if (event.item.type !== 'message') {
        return;
      }
      if (!event.user) {
        return;
      }

      try {
        const history = await client.conversations.history({
          channel: event.item.channel,
          latest: event.item.ts,
          inclusive: true,
          limit: 1,
        });
        const message = history.messages?.[0];
        if (!message?.text) {
          return;
        }

        // permalink fetch 실패는 graceful — task 적재 자체는 진행.
        let permalink: string | undefined;
        try {
          const linkResponse = await client.chat.getPermalink({
            channel: event.item.channel,
            message_ts: event.item.ts,
          });
          if (linkResponse.ok && typeof linkResponse.permalink === 'string') {
            permalink = linkResponse.permalink;
          }
        } catch (linkError: unknown) {
          this.logger.warn(
            `Slack permalink 조회 실패 (channel=${event.item.channel} ts=${event.item.ts}): ${linkError instanceof Error ? linkError.message : String(linkError)}`,
          );
        }

        const result = await this.appendPushpinTaskService.execute({
          slackUserId: event.user,
          channelId: event.item.channel,
          messageTs: event.item.ts,
          text: message.text,
          permalink,
        });

        if (result.appended) {
          this.logger.log(
            `📌 task 적재 — user=${event.user} channel=${event.item.channel} ts=${event.item.ts}`,
          );
        } else {
          this.logger.warn(
            `📌 task skip — ${result.skipReason ?? '사유 미상'} (user=${event.user})`,
          );
        }
      } catch (error: unknown) {
        this.logger.warn(
          `📌 task 적재 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
