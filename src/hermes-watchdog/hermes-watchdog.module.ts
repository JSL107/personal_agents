import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { NotificationQueueModule } from '../notification/notification-queue.module';
import { HermesWatchdogScheduler } from './application/hermes-watchdog.scheduler';
import { HERMES_WATCHDOG_QUEUE } from './domain/hermes-watchdog.type';
import { HermesJobsReader } from './infrastructure/hermes-jobs.reader';
import { HermesWatchdogConsumer } from './infrastructure/hermes-watchdog.consumer';

// Hermes(별도 프로세스) 의 cron 이 조용히 죽는 것을 이대리 쪽에서 감시한다.
// 2026-09-18: Hermes 아침신문이 codex 쿼터 소진으로 실패했는데 아무 알림도 없었다.
// Hermes 안에 감시를 두면 Hermes 가 죽을 때 감시도 같이 죽으므로 밖(여기)에 둔다.
//
// 알림 배관은 NotificationQueueModule 을 그대로 쓴다 — Slack 발송·30분 dedupe·
// owner 미설정 시 noop 이 이미 NotificationConsumer 에 있다.
// HERMES_WATCHDOG_OWNER_SLACK_USER_ID 미설정 시 scheduler 가 graceful skip.
@Module({
  imports: [
    BullModule.registerQueue({ name: HERMES_WATCHDOG_QUEUE }),
    NotificationQueueModule,
  ],
  providers: [
    HermesWatchdogScheduler,
    HermesWatchdogConsumer,
    HermesJobsReader,
  ],
})
export class HermesWatchdogModule {}
