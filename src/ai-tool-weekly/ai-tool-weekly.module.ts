import { Module } from '@nestjs/common';

import { AiWeeklyMetricsRunner } from './infrastructure/ai-weekly-metrics.runner';

@Module({
  providers: [AiWeeklyMetricsRunner],
  exports: [AiWeeklyMetricsRunner],
})
export class AiToolWeeklyModule {}
