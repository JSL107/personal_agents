import { Module } from '@nestjs/common';

import { SLACK_DELIVERY_REPOSITORY } from './domain/port/slack-delivery.repository.port';
import { SlackDeliveryPrismaRepository } from './infrastructure/slack-delivery.prisma.repository';

@Module({
  providers: [
    {
      provide: SLACK_DELIVERY_REPOSITORY,
      useClass: SlackDeliveryPrismaRepository,
    },
  ],
  exports: [SLACK_DELIVERY_REPOSITORY],
})
export class SlackDeliveryModule {}
