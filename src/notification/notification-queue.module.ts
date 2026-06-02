import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { NotificationPublisher } from './application/notification-publisher.service';
import { NOTIFICATION_QUEUE } from './domain/notification.type';

// Producer 전용 module — Redis (BullMQ) 만 의존. SlackModule 의존 X 라 circular 위험 0.
// ModelRouterModule / 3 cron consumer module 가 본 module 을 imports 해 NotificationPublisher 를 inject.
// 실제 Slack 발송은 NotificationModule (Consumer, 별도) 의 NotificationConsumer 가 처리.
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_QUEUE })],
  providers: [NotificationPublisher],
  exports: [NotificationPublisher],
})
export class NotificationQueueModule {}
