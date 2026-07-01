import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../model-router/model-router.module';
import { PreferenceProfileModule } from '../preference-profile/preference-profile.module';
import { HumanizeService } from './application/humanize.service';

@Module({
  imports: [ModelRouterModule, PreferenceProfileModule],
  providers: [HumanizeService],
  exports: [HumanizeService],
})
export class HumanizeModule {}
