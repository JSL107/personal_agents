import { Module } from '@nestjs/common';

import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { SlackService } from './slack.service';

@Module({
  imports: [PmAgentModule, WorkReviewerModule],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
