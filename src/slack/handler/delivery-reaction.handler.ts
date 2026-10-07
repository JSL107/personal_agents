import { Inject, Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import {
  SLACK_DELIVERY_REPOSITORY,
  SlackDeliveryRepositoryPort,
} from '../domain/port/slack-delivery.repository.port';
import { SlackHandler } from '../domain/port/slack-handler.port';

// reaction_removed 는 집계하지 않아 반응 토글은 두 번 센다(다른 반응 핸들러와 동일).
// 원장 밖 메시지(postPreviewMessage, postProposalMessage, say() 답글, direct WebClient 두 경로)는 집계하지 않는다.
@Injectable()
export class DeliveryReactionHandler implements SlackHandler {
  private readonly logger = new Logger(DeliveryReactionHandler.name);

  constructor(
    @Inject(SLACK_DELIVERY_REPOSITORY)
    private readonly deliveryRepository: SlackDeliveryRepositoryPort,
  ) {}

  register(app: App): void {
    app.event('reaction_added', async ({ event, context }) => {
      if (event.item.type !== 'message') {
        return;
      }
      if (!event.user || event.user === context.botUserId) {
        return;
      }

      try {
        await this.deliveryRepository.incrementReactionCount({
          channelId: event.item.channel,
          messageTs: event.item.ts,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `발송 반응 집계 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
