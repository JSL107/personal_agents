import { Inject, Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import {
  REACTION_SIGNAL_REPOSITORY,
  ReactionSignalRepositoryPort,
} from '../../preference-profile/domain/port/reaction-signal.repository.port';
import { SlackHandler } from '../domain/port/slack-handler.port';

// PREFERENCE_LEARNING 세 번째 신호원 — 사용자가 이대리(봇) 메시지에 👍/👎 를 달면 그 판정과
// 메시지 본문을 저장해 ReactionSignalSource 가 선호 학습 신호로 읽어가게 한다.
// pushpin/inbox reaction handler(SlackPushpinReactionHandler, SlackInboxReactionHandler)와
// 같은 구조(이벤트 등록 → conversations.history 로 본문 조회 → graceful 실패)를 따른다.
//
// 사람이 쓴 메시지에 대한 반응은 대상이 아니다 — message.bot_id 유무로 "이대리 산출물에 대한
// 판정"만 골라낸다(사람 발화에 대한 호오는 이 학습이 다룰 선호 신호가 아니다).
//
// reaction_removed 는 이번 범위가 아니다 — 취소된 판정을 신호에서 지우는 것은 다루지 않는다.
// reaction_added 도 멱등하지 않다(toggle off → on 시 두 번 발화 가능) — repository 의 unique
// 제약이 중복 저장을 막는다.
const TARGET_EMOJIS = ['+1', 'thumbsup', '-1', 'thumbsdown'];

@Injectable()
export class PreferenceReactionHandler implements SlackHandler {
  private readonly logger = new Logger(PreferenceReactionHandler.name);

  constructor(
    @Inject(REACTION_SIGNAL_REPOSITORY)
    private readonly reactionRepository: ReactionSignalRepositoryPort,
  ) {}

  register(app: App): void {
    app.event('reaction_added', async ({ event, client, context }) => {
      if (!TARGET_EMOJIS.includes(event.reaction)) {
        return;
      }
      if (event.item.type !== 'message') {
        return;
      }
      if (!event.user) {
        return;
      }
      // 봇이 스스로 단 반응은 사람의 판정이 아니다. 지금은 봇이 반응을 달지 않지만, 카드에
      // 👍/👎 를 미리 달아 클릭 한 번으로 받는 방식을 쓰면 그 씨앗이 매번 신호로 저장된다.
      // 그때 가서 걸러도 이미 쌓인 행은 남으므로 수집 경계에서 먼저 막는다.
      if (event.user === context.botUserId) {
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
        // bot_id 가 없으면 사람이 쓴 메시지 — 이대리 산출물에 대한 판정이 아니므로 skip.
        if (!message?.bot_id) {
          return;
        }
        if (!message.text) {
          return;
        }

        await this.reactionRepository.record({
          slackUserId: event.user,
          channelId: event.item.channel,
          messageTs: event.item.ts,
          emoji: event.reaction,
          messageText: message.text,
        });
        this.logger.log(
          `선호 반응 저장 — user=${event.user} emoji=${event.reaction} channel=${event.item.channel} ts=${event.item.ts}`,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `선호 반응 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
