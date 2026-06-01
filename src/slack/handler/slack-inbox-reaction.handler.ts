import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';

import { SlackInboxService } from '../../slack-inbox/application/slack-inbox.service';
import { SlackHandler } from '../domain/port/slack-handler.port';

// OPS-3 — 특정 이모지 reaction 으로 메시지를 SlackInbox 에 누적.
// 사용자가 채널/DM 메시지에 emoji (default: raised_hand) 를 달면 그 메시지를 PM 컨텍스트의 "task 후보" 로
// 인지하기 위한 inbox 에 적재. PM 의 자동 컨텍스트 수집에서 활용.
//
// 본 핸들러는 외부 발송 path (postMessage / postPreviewMessage) 와 무관하며 들어오는 reaction event 만
// 듣는다. slack.service.ts 가 명령/액션 + 외부 sender + lifecycle 만 담당하도록 분리 (C-5).
//
// C-5 Phase 11 — slack.service.registerReactionHandlers → @Injectable() class.
@Injectable()
export class SlackInboxReactionHandler implements SlackHandler {
  private readonly logger = new Logger(SlackInboxReactionHandler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly slackInboxService: SlackInboxService,
  ) {}

  register(app: App): void {
    const inboxEmoji =
      this.configService.get<string>('SLACK_INBOX_EMOJI') ?? 'raised_hand';

    app.event('reaction_added', async ({ event, client }) => {
      if (event.reaction !== inboxEmoji) {
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

        await this.slackInboxService.addItem({
          slackUserId: event.user,
          channelId: event.item.channel,
          messageTs: event.item.ts,
          text: message.text,
        });
        this.logger.log(
          `Slack Inbox 추가 — user=${event.user} channel=${event.item.channel} ts=${event.item.ts}`,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Slack Inbox 추가 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
