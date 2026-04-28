import { Module } from '@nestjs/common';

import { ImpactReporterModule } from '../agent/impact-reporter/impact-reporter.module';
import { WebhookController } from './interface/webhook.controller';

@Module({
  imports: [ImpactReporterModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
