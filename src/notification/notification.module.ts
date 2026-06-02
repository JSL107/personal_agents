import { Module } from '@nestjs/common';

import { SlackModule } from '../slack/slack.module';
import { NotificationConsumer } from './infrastructure/notification.consumer';
import { NotificationQueueModule } from './notification-queue.module';

// Consumer 단면 — NotificationQueueModule + SlackModule imports. Slack 의존이 이 module 안에서만.
//
// 의존 방향:
//   AppModule
//     ├─ NotificationQueueModule (Producer, SlackModule 의존 X) ← ModelRouterModule / cron module 가 직접 imports.
//     └─ NotificationModule (Consumer, SlackModule 의존) ← 본 module. AppModule 만 imports.
//
// 이 분리로 ModelRouter ↔ Slack 의 circular 가 해소됨 (PR #48 의 silent hang 원인).
@Module({
  imports: [NotificationQueueModule, SlackModule],
  providers: [NotificationConsumer],
})
export class NotificationModule {}
