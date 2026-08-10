import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { ModelRouterModule } from '../model-router/model-router.module';
import { PreferenceProfileModule } from '../preference-profile/preference-profile.module';
import { HumanizeService } from './application/humanize.service';

@Module({
  imports: [AgentRunModule, ModelRouterModule, PreferenceProfileModule],
  providers: [HumanizeService],
  exports: [HumanizeService],
})
export class HumanizeModule {}
