import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { DailyEvalScheduler } from './application/daily-eval.scheduler';
import { DAILY_EVAL_QUEUE } from './domain/daily-eval.type';
import { DailyEvalConsumer } from './infrastructure/daily-eval.consumer';

// workflow-phase-definition §5.2 Daily Eval — 매일 19:00 KST PO_EVAL 자동 트리거.
// PRO-4 Weekly Summary 패턴 차용 — BullMQ repeatable + SlackNotifierPort (useExisting: SlackService).
@Module({
  imports: [
    BullModule.registerQueue({ name: DAILY_EVAL_QUEUE }),
    PoEvalModule,
    SlackModule,
  ],
  providers: [
    DailyEvalScheduler,
    DailyEvalConsumer,
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class DailyEvalModule {}
