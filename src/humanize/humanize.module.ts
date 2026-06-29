import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../model-router/model-router.module';
import { HumanizeService } from './application/humanize.service';

@Module({
  imports: [ModelRouterModule],
  providers: [HumanizeService],
  exports: [HumanizeService],
})
export class HumanizeModule {}
