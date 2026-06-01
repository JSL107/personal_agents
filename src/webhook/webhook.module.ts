import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { BeFixModule } from '../agent/be-fix/be-fix.module';
import { BeSreModule } from '../agent/be-sre/be-sre.module';
import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { SlackModule } from '../slack/slack.module';
import {
  BE_FIX_QUEUE,
  BE_SRE_QUEUE,
  CODE_REVIEWER_QUEUE,
  IMPACT_REPORT_QUEUE,
} from './domain/webhook.type';
import { WebhookBeFixConsumer } from './infrastructure/be-fix.consumer';
import { WebhookBeSreConsumer } from './infrastructure/be-sre.consumer';
import { WebhookCodeReviewerConsumer } from './infrastructure/code-reviewer.consumer';
import { WebhookImpactReportConsumer } from './infrastructure/impact-report.consumer';
import { WebhookController } from './interface/webhook.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: IMPACT_REPORT_QUEUE }),
    BullModule.registerQueue({ name: BE_FIX_QUEUE }),
    BullModule.registerQueue({ name: BE_SRE_QUEUE }),
    BullModule.registerQueue({ name: CODE_REVIEWER_QUEUE }),
    ImpactReporterModule,
    BeFixModule,
    BeSreModule,
    // pull_request.opened webhook 자동 review — ReviewPullRequestUsecase + SlackService.postMessage.
    CodeReviewerModule,
    SlackModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookImpactReportConsumer,
    WebhookBeFixConsumer,
    WebhookBeSreConsumer,
    WebhookCodeReviewerConsumer,
  ],
})
export class WebhookModule {}
