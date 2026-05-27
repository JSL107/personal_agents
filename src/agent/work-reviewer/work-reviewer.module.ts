import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { NotionModule } from '../../notion/notion.module';
import {
  AGENT_DISPATCHER_PORT,
  provideAgentDispatcher,
} from '../../router/domain/port/agent-dispatcher.port';
import { GenerateWorklogUsecase } from './application/generate-worklog.usecase';
import { WorkReviewerDispatcher } from './infrastructure/work-reviewer.dispatcher';

@Module({
  imports: [ModelRouterModule, AgentRunModule, NotionModule],
  providers: [
    GenerateWorklogUsecase,
    WorkReviewerDispatcher,
    provideAgentDispatcher(WorkReviewerDispatcher),
  ],
  exports: [GenerateWorklogUsecase, AGENT_DISPATCHER_PORT],
})
export class WorkReviewerModule {}
