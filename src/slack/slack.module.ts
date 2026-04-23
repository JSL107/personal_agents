import { Module } from '@nestjs/common';

import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { PmAgentModule } from '../agent/pm/pm-agent.module';
import { WorkReviewerModule } from '../agent/work-reviewer/work-reviewer.module';
import { SlackService } from './slack.service';

@Module({
  imports: [PmAgentModule, WorkReviewerModule, CodeReviewerModule],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
