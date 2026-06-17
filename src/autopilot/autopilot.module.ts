import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { AutopilotOrchestrator } from './application/autopilot.orchestrator';
import { AutopilotScheduler } from './application/autopilot.scheduler';
import { AUTOPILOT_CRON_QUEUE } from './domain/autopilot.type';
import { AUTOPILOT_TASKS } from './domain/autopilot-task.port';
import { AutopilotConsumer } from './infrastructure/autopilot.consumer';
import { MorningBriefingAutopilotTask } from './infrastructure/tasks/morning-briefing.autopilot-task';
import { PoEvalAutopilotTask } from './infrastructure/tasks/po-eval.autopilot-task';

// Autopilot 골격 — daily-eval.module 패턴(BullMQ repeatable + SlackNotifierPort useExisting).
// CronIdempotencyService 는 @Global(CronIdempotencyModule) 이라 별도 import 불필요.
@Module({
  imports: [
    BullModule.registerQueue({ name: AUTOPILOT_CRON_QUEUE }),
    PoEvalModule,
    PmAgentModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    AutopilotScheduler,
    AutopilotConsumer,
    AutopilotOrchestrator,
    PoEvalAutopilotTask,
    MorningBriefingAutopilotTask,
    {
      // 플레이북 task 레지스트리 — 신규 task 는 여기 inject 에 추가.
      provide: AUTOPILOT_TASKS,
      useFactory: (
        poEval: PoEvalAutopilotTask,
        morning: MorningBriefingAutopilotTask,
      ) => [poEval, morning],
      inject: [PoEvalAutopilotTask, MorningBriefingAutopilotTask],
    },
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class AutopilotModule {}
