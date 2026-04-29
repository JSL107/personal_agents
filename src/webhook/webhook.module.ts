import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { IMPACT_REPORT_QUEUE } from './domain/webhook.type';
import { WebhookImpactReportConsumer } from './infrastructure/impact-report.consumer';
import { WebhookController } from './interface/webhook.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: IMPACT_REPORT_QUEUE }),
    ImpactReporterModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookImpactReportConsumer],
})
export class WebhookModule {}
