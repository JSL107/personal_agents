import { Module } from '@nestjs/common';

import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { SlackService } from './slack.service';

@Module({
  imports: [PmAgentModule],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
