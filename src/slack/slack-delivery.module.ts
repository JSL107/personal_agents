import { Module } from '@nestjs/common';

import { MENTION_RECEIPT_REPOSITORY } from './domain/port/mention-receipt.repository.port';
import { SLACK_DELIVERY_REPOSITORY } from './domain/port/slack-delivery.repository.port';
import { MentionReceiptPrismaRepository } from './infrastructure/mention-receipt.prisma.repository';
import { SlackDeliveryPrismaRepository } from './infrastructure/slack-delivery.prisma.repository';

@Module({
  providers: [
    {
      provide: SLACK_DELIVERY_REPOSITORY,
      useClass: SlackDeliveryPrismaRepository,
    },
    {
      provide: MENTION_RECEIPT_REPOSITORY,
      useClass: MentionReceiptPrismaRepository,
    },
  ],
  exports: [SLACK_DELIVERY_REPOSITORY, MENTION_RECEIPT_REPOSITORY],
})
export class SlackDeliveryModule {}
