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
        // `conversations.history` 를 쓰지 않는 이유 — 그것은 스레드 답글을 반환하지 않는다.
        // 이대리의 자연어 멘션 응답은 전부 스레드 답글로 나가므로(`router-message.handler.ts`
        // 가 thread_ts 를 붙여 게시한다), history 로 조회하면 그 답글 대신 직전 최상위 메시지가
        // 돌아온다. 가장 많이 쓰는 경로의 반응이 수집되지 않고, 최상위 메시지가 봇 것이면
        // 엉뚱한 본문이 신호로 저장되기까지 한다.
        //
        // `conversations.replies` 는 스레드 답글 ts 로도 조회되고 스레드가 없는 최상위 메시지도
        // 자기 자신을 돌려주므로 두 경우를 한 경로로 덮는다. 그래도 ts 를 다시 맞춰보는 이유는
        // 반환이 항상 한 건이라는 보장이 없어서다 — 엉뚱한 본문을 저장하지 않으려면 여기서
        // 걸러야 한다.
        const thread = await client.conversations.replies({
          channel: event.item.channel,
          ts: event.item.ts,
          inclusive: true,
          limit: 1,
        });
        const message = thread.messages?.find(
          (candidate) => candidate.ts === event.item.ts,
        );
        // 이 앱이 쓴 메시지만 받는다. bot_id 유무만 보면 워크스페이스의 다른 봇이 쓴 메시지에
        // 남긴 반응까지 이대리 선호로 저장돼 추론을 오염시킨다. context.botId 가 없으면
        // 판별할 수 없으므로 저장하지 않는다(모르는 채 쌓는 쪽이 더 나쁘다).
        if (!message?.bot_id || message.bot_id !== context.botId) {
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
